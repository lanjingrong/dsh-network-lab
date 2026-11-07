import { readFileSync } from 'node:fs'
import { TelnetSession, probeTelnet } from './lib/telnet.js'
import {
  findDevice,
  publicDevice,
  readDevices,
  removeDevice,
  resolveProgressPath,
  resolveStorePath,
  upsertDevice,
  emptyProgress,
  readProgress,
  readProgressQueued,
  writeProgress,
} from './lib/store.js'
import { LABS, findLab } from './lib/labs.js'
import { QUIZ_TOPICS, createQuiz, gradeQuiz } from './lib/quiz.js'
import { getReference, referenceIndex, searchReference } from './lib/reference.js'
import {
  CURRICULUM,
  computeProgress,
  findPhase,
  listPhases,
  nextPhase,
  phaseMarkdown,
  routeMarkdown,
} from './lib/curriculum.js'
import { FAULTS, diagnosisMarkdown, findFault, faultIndexMarkdown, faultMarkdown, listFaults } from './lib/faults.js'
import {
  buildSysname,
  checkSysname,
  descriptionRulesMarkdown,
  reviewConfig,
  reviewMarkdown,
  standardIndexMarkdown,
  vlanPlanMarkdown,
} from './lib/standard.js'
import {
  checklistForLab,
  checklistIndexMarkdown,
  checklistMarkdown,
  findChecklist,
  listChecklists,
} from './lib/checklist.js'
import {
  matchPitfalls,
  pitfallIndexMarkdown,
  pitfallMarkdown,
  pitfallMatchMarkdown,
  findPitfall,
  listPitfalls,
} from './lib/knowledge.js'
import { quizFromFault, quizPlanMarkdown, faultQuizPlan } from './lib/faultquiz.js'

export const name = 'dsh-network-lab'
export const inject = ['tools', 'systemPrompt']

const SESSION_IDLE_MS = 15 * 60 * 1000
const MAX_COMMANDS = 25
const MAX_COMMAND_LENGTH = 512
const DANGEROUS = /^(reboot|reset\s+saved-configuration|format|delete\b|undo\s+startup|startup\s+saved-configuration|factory-configuration)/i

const sessions = new Map()
const quizzes = new Map()
const completedPhases = new Set()

function sessionKey(device) {
  return `${device.host}:${device.port}:${device.username || ''}`
}

function sessionList() {
  return [...sessions.values()].map((entry) => ({
    id: entry.device.id,
    host: entry.device.host,
    port: entry.device.port,
    connected: entry.session.connected,
    idleMs: Date.now() - entry.lastUsed,
  }))
}

function closeAllSessions() {
  for (const entry of sessions.values()) {
    try { entry.session.close() } catch { /* ignore */ }
  }
  sessions.clear()
}

function closeSession(ref) {
  if (!ref) {
    closeAllSessions()
    return 0
  }
  let count = 0
  for (const [key, entry] of sessions.entries()) {
    if (entry.device.id === ref || key === ref) {
      try { entry.session.close() } catch { /* ignore */ }
      sessions.delete(key)
      count += 1
    }
  }
  return count
}

async function getSession(device) {
  const key = sessionKey(device)
  const existing = sessions.get(key)
  if (existing) {
    if (Date.now() - existing.lastUsed > SESSION_IDLE_MS) {
      try { existing.session.close() } catch { /* ignore */ }
      sessions.delete(key)
    } else if (existing.session.connected) {
      existing.lastUsed = Date.now()
      return existing.session
    } else {
      sessions.delete(key)
    }
  }
  const session = new TelnetSession(device)
  await session.connect()
  sessions.set(key, { session, device, lastUsed: Date.now() })
  return session
}

function loadPrompt() {
  try {
    return readFileSync(new URL('./prompts/system.md', import.meta.url), 'utf8').trim()
  } catch {
    return '你是网络工程实验教练。使用 netlab_* 工具连接 eNSP，先画拓扑再配置，先验证再下结论。'
  }
}

const str = (description) => ({ type: 'string', ...(description ? { description } : {}) })
const int = (description) => ({ type: 'integer', ...(description ? { description } : {}) })
const bool = (description) => ({ type: 'boolean', ...(description ? { description } : {}) })
const arr = (items, description) => ({ type: 'array', items, ...(description ? { description } : {}) })
const obj = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

const DEVICE_SCHEMA = obj({
  id: str(),
  name: str(),
  host: str(),
  port: int(),
  protocol: str(),
  username: str(),
  hasPassword: bool(),
  notes: str(),
  updatedAt: str(),
})

const EXEC_SCHEMA = obj({
  command: str(),
  output: str(),
  ok: bool(),
  prompt: str(),
})

const SAVE_SCHEMA = obj({
  ok: bool(),
  output: str(),
  prompt: str(),
})

const EXEC_OUTPUT = obj({
  ok: bool(),
  markdown: str(),
  transcript: str(),
  device: DEVICE_SCHEMA,
  results: arr(EXEC_SCHEMA),
  save: SAVE_SCHEMA,
  prompt: str(),
  error: str(),
  sessionClosed: bool(),
}, ['ok', 'markdown', 'transcript'])

const VERIFY_OUTPUT = obj({
  ok: bool(),
  markdown: str(),
  results: arr(obj({
    role: str(),
    command: str(),
    status: str(),
    detail: str(),
    output: str(),
  }, ['role', 'command', 'status', 'detail'])),
}, ['ok', 'markdown', 'results'])

const MARKDOWN_OUTPUT = obj({ action: str(), markdown: str() })

function tool(options) {
  const parameters = obj(options.properties, options.required || Object.keys(options.properties))
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: {
      schema: options.outputSchema || MARKDOWN_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: value.markdown || value.transcript || '' }],
    },
    execute: options.execute,
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    isConcurrencySafe: false,
  }
}

function deviceTable(devices) {
  if (!devices.length) {
    return '还没有设备。先运行 `netlab_devices action=scan` 扫描 eNSP 端口，或 `action=add` 手动添加。'
  }
  const rows = [
    '| id | 名称 | 地址 | 协议 | 用户名 | 密码 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...devices.map((device) =>
      `| ${device.id} | ${device.name} | ${device.host}:${device.port} | ${device.protocol} | ${device.username || '-'} | ${device.hasPassword ? '已保存' : '-'} |`),
  ]
  return rows.join('\n')
}

function scanTable(results) {
  const open = results.filter((item) => item.open)
  if (!open.length) return '扫描范围内没有发现开放端口。确认 eNSP 设备已启动，或扩大端口范围。'
  return [
    '| 端口 | 提示符/横幅 |',
    '| --- | --- |',
    ...open.map((item) => `| ${item.port} | ${(item.prompt || item.banner || '(已开放，无横幅)').replace(/\|/g, '\\|').slice(0, 120)} |`),
  ].join('\n')
}

function execMarkdown(result) {
  const parts = []
  if (result.device) {
    parts.push(`设备：**${result.device.name}**（${result.device.host}:${result.device.port}）`)
  }
  if (result.error) parts.push(`> 执行失败：${result.error}${result.sessionClosed ? '。会话已关闭，可重试。' : ''}`)
  for (const item of result.results || []) {
    parts.push(`### \`${item.command}\``)
    parts.push('```text')
    parts.push(item.output || '(无输出)')
    parts.push('```')
  }
  if (result.save) {
    parts.push('### `save`')
    parts.push('```text')
    parts.push(result.save.output || '(无输出)')
    parts.push('```')
  }
  if (result.prompt) parts.push(`当前提示符：\`${result.prompt}\``)
  const hints = pitfallSection(result)
  if (hints) parts.push(hints)
  return parts.join('\n\n')
}

/**
 * Turn a failed or error-prone exec result into "你可能踩了这些坑" hints,
 * using the bundled eNSP pitfall knowledge base.
 */
export function pitfallSection(result) {
  const parts = []
  if (result.error) parts.push(result.error)
  for (const item of result.results || []) {
    if (item.ok === false) parts.push(`${item.command}\n${item.output || ''}`)
  }
  if (result.save && result.save.ok === false) parts.push(result.save.output || '')
  if (!parts.length) return ''
  const matches = matchPitfalls(parts.join('\n'), { limit: 2 })
  if (!matches.length) return ''
  const lines = ['---', '### 你可能踩了这些坑', '']
  for (const match of matches) {
    lines.push(`**${match.pitfall.title}**（\`${match.pitfall.id}\`）`)
    lines.push(`- 原因：${match.pitfall.hint}`)
    lines.push(`- 先查：${match.pitfall.check.map((item) => `\`${item}\``).join('、')}`)
    lines.push(`- 处理：\`${match.pitfall.fix[0]}\`${match.pitfall.fix.length > 1 ? '（详见 netlab_reference）' : ''}`)
    lines.push('')
  }
  lines.push(`完整说明：\`netlab_reference topic=pitfall query=${matches[0].pitfall.id}\``)
  return lines.join('\n')
}

function labMarkdown(lab, mode, hintIndex = 0) {
  const parts = [
    `# ${lab.title}`,
    `**难度**：${lab.level}　**建议用时**：${lab.minutes} 分钟　**标签**：${lab.tags.join(' / ')}`,
    ...(lab.devices ? ['', `**设备要求**：${lab.devices}`] : []),
    ...(lab.prereq ? [`**前置知识**：${lab.prereq}`] : []),
    '',
    `## 场景`,
    lab.scenario,
    '',
    '## 拓扑',
    '```text',
    lab.topology,
    '```',
    '',
    '## 目标',
    ...lab.objectives.map((item) => `- ${item}`),
    '',
    '## 任务',
    ...lab.tasks.map((item, index) => `${index + 1}. ${item}`),
  ]

  if (mode === 'show') {
    parts.push('', '## 验证点', ...lab.verify.map((check) => `- \`${check.role}\`：\`${check.command}\``))
    parts.push('', '> 先自己做。需要时用 `netlab_lab action=hint` 获取分级提示；完整参考配置用 `action=solution`。')
  }

  if (mode === 'hint') {
    const index = Math.max(0, Math.min(Number(hintIndex) || 0, lab.hints.length - 1))
    parts.push('', `## 提示 ${index + 1}/${lab.hints.length}`, lab.hints[index])
    if (index + 1 < lab.hints.length) parts.push('', '需要下一级提示：`netlab_lab action=hint hintIndex=' + (index + 1) + '`')
  }

  if (mode === 'solution') {
    parts.push('', '## 参考配置（先尝试，再看答案）')
    for (const block of lab.solution) {
      parts.push(`### ${block.role}`, '```text', ...block.commands, '```')
    }
    parts.push('', '## 常见坑', ...lab.pitfalls.map((item) => `- ${item}`))
    if (Array.isArray(lab.why) && lab.why.length) {
      parts.push('', '## 老师傅追问', ...lab.why.map((item) => `- ${item}`))
    }
  }

  return parts.join('\n')
}

function verifyMarkdown(lab, results) {
  const passed = results.filter((item) => item.status === 'pass').length
  const failed = results.filter((item) => item.status === 'fail').length
  const skipped = results.filter((item) => item.status === 'skip').length
  const parts = [
    `# 验证：${lab.title}`,
    `通过 **${passed}**，失败 **${failed}**，跳过 **${skipped}**`,
    '',
    '| 角色 | 检查 | 结果 | 说明 |',
    '| --- | --- | --- | --- |',
    ...results.map((item) =>
      `| ${item.role} | \`${item.command.replace(/\|/g, '\\|')}\` | ${item.status === 'pass' ? '✅ 通过' : item.status === 'fail' ? '❌ 失败' : '⏭ 跳过'} | ${(item.detail || '').replace(/\|/g, '\\|').slice(0, 160)} |`),
  ]
  if (skipped) parts.push('', '未绑定的角色请用 `bindings` 参数补上，例如 `[{"role":"SW1","device":"sw1"}]`。')
  return parts.join('\n')
}

function quizMarkdownNew(quiz) {
  const parts = [
    `# 小测 ${quiz.id}`,
    '把答案按顺序传给 `netlab_quiz action=grade quizId=... answers=["B","C",...]`。',
    '',
  ]
  quiz.questions.forEach((question, index) => {
    parts.push(`**${index + 1}. [${question.topic}/${question.difficulty}] ${question.question}**`)
    question.options.forEach((option, optionIndex) => {
      parts.push(`- ${String.fromCharCode(65 + optionIndex)}. ${option}`)
    })
    parts.push('')
  })
  return parts.join('\n')
}

function quizMarkdownGrade(result) {
  const parts = [
    `# 得分：${result.score}/${result.total}（${result.percent}%）`,
    '',
    '| # | 你的答案 | 正确答案 | 结果 |',
    '| --- | --- | --- | --- |',
    ...result.details.map((item, index) =>
      `| ${index + 1} | ${item.picked} | ${item.correct} | ${item.isCorrect ? '✅' : '❌'} |`),
    '',
  ]
  for (const item of result.details) {
    parts.push(`### ${item.isCorrect ? '✅' : '❌'} ${item.question}`)
    parts.push(item.explanation)
    parts.push('')
  }
  return parts.join('\n')
}

async function scanPorts(start, end) {
  const ports = []
  for (let port = start; port <= end; port += 1) ports.push(port)
  const results = new Array(ports.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(8, ports.length) }, async () => {
    while (cursor < ports.length) {
      const index = cursor
      cursor += 1
      results[index] = await probeTelnet('127.0.0.1', ports[index], 750)
    }
  })
  await Promise.all(workers)
  return results
}

function parsePort(value, fallback) {
  const number = Number(value ?? fallback)
  if (!Number.isInteger(number) || number < 1 || number > 65535) throw new Error('端口必须是 1-65535 的整数')
  return number
}

function validateCommands(commands) {
  if (!Array.isArray(commands) || commands.length === 0) throw new Error('commands 至少包含一条 VRP 命令')
  if (commands.length > MAX_COMMANDS) throw new Error(`单次最多执行 ${MAX_COMMANDS} 条命令`)
  return commands.map((command) => {
    const value = String(command ?? '').trim()
    if (!value) throw new Error('命令不能为空')
    if (value.length > MAX_COMMAND_LENGTH) throw new Error(`单条命令不能超过 ${MAX_COMMAND_LENGTH} 字符`)
    if (/[\r\n]/.test(value)) throw new Error('每条命令只能是一行，请拆成多个数组元素')
    return value
  })
}

const devicesTool = tool({
  name: 'netlab_devices',
  description: '管理 eNSP 设备：列出、添加、删除、扫描 127.0.0.1 的 Telnet 端口，或关闭设备会话。连接 eNSP 前先用 scan 找端口。',
  properties: {
    action: { type: 'string', enum: ['list', 'add', 'remove', 'scan', 'disconnect'], description: 'list/add/remove/scan/disconnect' },
    id: str('设备 id，例如 sw1'),
    name: str('显示名称'),
    host: str('设备地址，默认 127.0.0.1'),
    port: int('Telnet 端口，eNSP 第一台设备通常为 2000'),
    username: str('登录用户名；设备无认证时留空'),
    password: str('登录密码；不会在返回中回显'),
    notes: str('备注'),
    rangeStart: int('扫描起始端口，默认 2000'),
    rangeEnd: int('扫描结束端口，默认 2020'),
  },
  required: ['action'],
  timeoutMs: 60000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'list') {
      const devices = (await readDevices()).map(publicDevice)
      return {
        action,
        markdown: `# eNSP 设备\n\n${deviceTable(devices)}\n\n配置文件：\`${resolveStorePath()}\`\n\n活动会话：${sessionList().length ? `${sessionList().length} 个` : '无'}`,
      }
    }
    if (action === 'add') {
      if (!args.id) throw new Error('add 需要 id')
      const { device, replaced } = await upsertDevice({
        id: args.id,
        name: args.name,
        host: args.host,
        port: args.port,
        protocol: 'telnet',
        username: args.username,
        password: args.password,
        notes: args.notes,
      })
      return {
        action,
        markdown: `${replaced ? '已更新' : '已添加'}设备 **${device.name}**（\`${device.id}\` → ${device.host}:${device.port}）。\n\n下一步：\`netlab_exec device=${device.id} commands=["display version"]\`\n\n密码只保存在本机设备文件中，不会回显。`,
      }
    }
    if (action === 'remove') {
      if (!args.id) throw new Error('remove 需要 id')
      closeSession(args.id)
      const removed = await removeDevice(args.id)
      return { action, markdown: removed ? `已删除设备 \`${args.id}\`。` : `没有找到设备 \`${args.id}\`。` }
    }
    if (action === 'disconnect') {
      const count = closeSession(args.id)
      return { action, markdown: count ? `已关闭 ${count} 个会话。` : '没有匹配的活动会话。' }
    }
    if (action === 'scan') {
      const start = parsePort(args.rangeStart, 2000)
      const end = parsePort(args.rangeEnd, 2020)
      if (end < start) throw new Error('rangeEnd 不能小于 rangeStart')
      if (end - start > 200) throw new Error('单次扫描最多 201 个端口')
      const results = await scanPorts(start, end)
      return {
        action,
        markdown: `# eNSP 端口扫描 127.0.0.1:${start}-${end}\n\n${scanTable(results)}\n\n找到端口后：\`netlab_devices action=add id=sw1 port=<端口>\`。若提示符为空，先确认设备已启动，并关闭占用该端口的 SecureCRT/PuTTY。`,
      }
    }
    throw new Error(`未知 action：${action}`)
  },
})

const execTool = tool({
  name: 'netlab_exec',
  description: '在 eNSP/华为 VRP 设备上执行一条或多条命令，会话会保持，便于连续配置。只返回真实设备输出；默认拒绝 reboot/reset saved-configuration 等破坏性命令（重启验证请用 netlab_reboot）。',
  properties: {
    device: str('设备 id，或 host:port，例如 sw1 / 127.0.0.1:2000'),
    commands: arr(str('单条 VRP 命令'), '按顺序执行的命令；不要包含换行'),
    timeoutMs: int('每条命令等待超时，默认 15000ms，最大 60000ms'),
    save: bool('执行完后是否 save 配置'),
    newSession: bool('是否先关闭旧会话再重连'),
    allowDestructive: bool('只有用户明确确认后才设为 true，允许 reboot/reset/delete 等'),
  },
  required: ['device', 'commands'],
  timeoutMs: 180000,
  outputSchema: EXEC_OUTPUT,
  async execute(args) {
    const commands = validateCommands(args.commands)
    const dangerous = commands.filter((command) => DANGEROUS.test(command))
    if (dangerous.length && !args.allowDestructive) {
      const isReboot = dangerous.some((command) => /^reboot/i.test(command))
      throw new Error(
        `拒绝执行破坏性命令：${dangerous.join('；')}。`
        + (isReboot
          ? '要重启验证配置，请用 netlab_reboot（先 phase=preflight，再 phase=reboot confirm=true），它会先检查保存状态、重启后自动自检。'
          : '先向用户说明影响并取得明确确认，再传 allowDestructive=true。'),
      )
    }
    const devices = await readDevices()
    const device = findDevice(devices, args.device)
    if (args.newSession) closeSession(device.id)
    const timeoutMs = Math.max(2000, Math.min(Number(args.timeoutMs) || 15000, 60000))
    const started = Date.now()
    try {
      const session = await getSession(device)
      const results = await session.exec(commands, { timeoutMs })
      const save = args.save ? await session.save() : undefined
      const value = {
        ok: results.every((item) => item.ok) && (!save || save.ok),
        device: publicDevice(device),
        results,
        ...(save ? { save } : {}),
        prompt: session.lastPrompt,
      }
      const markdown = execMarkdown({ ...value, durationMs: Date.now() - started })
      return {
        ...value,
        markdown,
        transcript: markdown,
      }
    } catch (error) {
      closeSession(device.id)
      const message = error instanceof Error ? error.message : String(error)
      const markdown = execMarkdown({
        device: publicDevice(device),
        error: message,
        sessionClosed: true,
        results: [],
      })
      return {
        ok: false,
        error: message,
        sessionClosed: true,
        device: publicDevice(device),
        results: [],
        markdown,
        transcript: markdown,
      }
    }
  },
})

const rebootTool = tool({
  name: 'netlab_reboot',
  description: '安全重启 eNSP 设备：两阶段确认（先 preflight 出清单，再 confirm=true 执行），自动处理 [Y/N]，重启后轮询端口并跑自检命令。用于验证“配置有没有真正落盘”。',
  properties: {
    device: str('设备 id，或 host:port'),
    phase: { type: 'string', enum: ['preflight', 'reboot'], description: 'preflight 只检查；reboot 才真正重启' },
    confirm: bool('reboot 阶段必须为 true，表示用户已明确同意重启'),
    check: arr(str('重启后要执行的自检命令'), '例如 ["display version", "display current-configuration | include sysname"]'),
    waitMs: int('重启后等待设备恢复的最长时间，默认 120000ms，最大 300000ms'),
  },
  required: ['device'],
  timeoutMs: 360000,
  outputSchema: MARKDOWN_OUTPUT,
  async execute(args) {
    const devices = await readDevices()
    const device = findDevice(devices, args.device)
    const phase = String(args.phase || 'preflight')
    const checks = Array.isArray(args.check) && args.check.length
      ? args.check.map(String)
      : ['display version', 'display current-configuration | include sysname']

    // Collect the preflight evidence: this is what makes a reboot safe.
    const preflight = []
    {
      const session = await getSession(device)
      const results = await session.exec(
        [
          'display current-configuration | include sysname',
          'display saved-configuration | include sysname',
          'display startup',
        ],
        { timeoutMs: 12000 },
      )
      preflight.push(...results)
    }

    const current = preflight.find((item) => /sysname/.test(item.output) && item.ok)?.output || ''
    const saved = preflight.find((item, index) => index === 1 && /sysname/.test(item.output))?.output || ''
    const sameName = Boolean(current && saved && sameNameExtract(current) === sameNameExtract(saved))
    const startup = preflight[2]?.output || ''
    const startupOk = !/NULL|No such file|not exist/i.test(startup) && Boolean(startup)

    if (phase === 'preflight') {
      const parts = [
        `# 重启前检查：${device.name}`,
        '',
        '| 检查项 | 结果 | 说明 |',
        '| --- | --- | --- |',
        `| 当前 sysname | ${sameNameExtract(current) || '(未读到)'} | |`,
        `| 已保存 sysname | ${sameNameExtract(saved) || '(未读到)'} | |`,
        `| 运行配置 == 已保存配置 | ${sameName ? '✅ 一致' : '❌ 不一致'} | 不一致说明有未保存修改 |`,
        `| 启动配置存在 | ${startupOk ? '✅' : '❌'} | display startup |`,
        '',
        '## 原始输出',
        ...preflight.map((item) => `### \`${item.command}\`\n\`\`\`text\n${item.output || '(无输出)'}\n\`\`\``),
        '',
      ]
      if (sameName && startupOk) {
        parts.push(
          '**结论**：可以重启。',
          '',
          `执行：\`netlab_reboot device=${args.device} phase=reboot confirm=true\``,
          '> 重启会中断设备几十秒到两分钟，期间所有会话断开；eNSP 里等同于真机重启。',
        )
      } else {
        parts.push(
          '**结论**：不建议现在重启。',
          '',
          '1. 先 `return` → `save` → 输入 `y`，把运行配置写入 flash。',
          '2. 再执行一次 `netlab_reboot device=' + args.device + ' phase=preflight` 确认一致。',
          '',
          '> 这正是 `save-compare` 实验要教的：重启暴露的是“没保存”，不是设备故障。',
        )
      }
      return { markdown: parts.join('\n') }
    }

    if (!args.confirm) {
      throw new Error('reboot 阶段需要 confirm=true，表示用户已明确同意重启该设备。先跑 phase=preflight 让用户看清单。')
    }

    // Re-confirm the save state right before rebooting; a stale preflight is a trap.
    const session = await getSession(device)
    const guard = await session.exec(['display current-configuration | include sysname', 'display saved-configuration | include sysname'], { timeoutMs: 12000 })
    const guardSame = sameNameExtract(guard[0]?.output || '') === sameNameExtract(guard[1]?.output || '')
    if (!guardSame) {
      throw new Error('重启前复核发现运行配置与已保存配置不一致（可能有未保存修改）。先 save 再重启，或明确接受丢失风险后手动处理。')
    }

    const waitMs = Math.max(3000, Math.min(Number(args.waitMs) || 120000, 300000))
    let rebootOutput = ''
    let disconnected = false
    try {
      const result = await session.reboot({ timeoutMs: 30000 })
      rebootOutput = result.output
      disconnected = result.disconnected
    } catch (error) {
      rebootOutput = error instanceof Error ? error.message : String(error)
    }
    closeSession(device.id)

    // Poll the console port until the device answers a prompt again.
    const started = Date.now()
    let recovered = null
    // A device that rejected the reboot never disconnects; don't burn the full wait.
    const effectiveWait = disconnected ? waitMs : Math.min(waitMs, 6000)
    while (Date.now() - started < effectiveWait) {
      await new Promise((resolve) => setTimeout(resolve, 3000))
      const probe = await probeTelnet(device.host, device.port, 1200)
      if (probe.open) {
        try {
          const fresh = await getSession({ ...device })
          const [version] = await fresh.exec(['display version'], { timeoutMs: 15000 })
          if (version && !looksLikeBootNoise(version.output)) {
            recovered = { version: version.output, waitMs: Date.now() - started }
            break
          }
        } catch {
          closeSession(device.id)
        }
      }
    }

    const parts = [
      `# 重启结果：${device.name}`,
      '',
      disconnected ? '设备按预期断开了控制台连接。' : '未检测到断开，设备可能拒绝重启或已立即恢复。',
      '',
      '## 重启输出',
      '```text',
      rebootOutput || '(无输出)',
      '```',
      '',
    ]

    if (!recovered) {
      parts.push(
        `**设备在 ${Math.round(waitMs / 1000)} 秒内未恢复响应。**`,
        '',
        '- eNSP 里手动确认设备是否还在启动',
        '- AR 路由器启动慢，可以 `netlab_reboot device=' + args.device + ' phase=preflight` 稍后重试',
        '- 端口可能被其他控制台占用',
      )
      return { markdown: parts.join('\n') }
    }

    parts.push(`设备在 **${(recovered.waitMs / 1000).toFixed(1)} 秒**后恢复。`, '', '## 重启后自检')
    const session2 = await getSession(device)
    const checks2 = await session2.exec(checks, { timeoutMs: 15000 })
    for (const item of checks2) {
      parts.push(`### \`${item.command}\``, '```text', item.output || '(无输出)', '```')
    }
    const configStillThere = /sysname/.test(checks2.map((item) => item.output).join('\n'))
    parts.push(
      '',
      configStillThere
        ? '✅ 配置在重启后仍然存在，说明**真正落盘了**。'
        : '❌ 重启后没看到预期配置，说明之前**没有真正保存**。回去重做 `save-compare` 实验。',
    )
    return { markdown: parts.join('\n') }
  },
})

function sameNameExtract(text) {
  const match = /sysname\s+(\S+)/.exec(String(text || ''))
  return match ? match[1] : ''
}

function looksLikeBootNoise(output) {
  return /Press any key|Booting|Loading|Copyright|saved configuration is being restored/i.test(String(output || ''))
}

const labTool = tool({
  name: 'netlab_lab',
  description: '获取内置网络实验：目录、任务书、分级提示或参考配置。适合 VLAN、静态路由、OSPF、NAT、ACL、DHCP、STP 学习。',
  properties: {
    action: { type: 'string', enum: ['list', 'show', 'hint', 'solution'], description: 'list/show/hint/solution' },
    lab: str('实验 id，例如 vlan-basic'),
    hintIndex: int('提示级别，从 0 开始'),
  },
  required: ['action'],
  timeoutMs: 15000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'list') {
      const rows = [
        '| id | 实验 | 难度 | 用时 | 标签 |',
        '| --- | --- | --- | --- | --- |',
        ...LABS.map((lab) => `| \`${lab.id}\` | ${lab.title} | ${lab.level} | ${lab.minutes} 分钟 | ${lab.tags.join(' / ')} |`),
      ]
      return { action, markdown: `# 实验目录\n\n${rows.join('\n')}\n\n用 \`netlab_lab action=show lab=<id>\` 打开任务书。` }
    }
    const lab = findLab(args.lab)
    if (!lab) throw new Error(`找不到实验 "${args.lab || ''}"。先运行 action=list。`)
    if (action === 'show') return { action, markdown: labMarkdown(lab, 'show') }
    if (action === 'hint') return { action, markdown: labMarkdown(lab, 'hint', args.hintIndex) }
    if (action === 'solution') return { action, markdown: labMarkdown(lab, 'solution') }
    throw new Error(`未知 action：${action}`)
  },
})

const verifyTool = tool({
  name: 'netlab_verify',
  description: '按实验内置检查项自动验证设备状态。需要把拓扑角色绑定到真实设备 id，例如 SW1→sw1。只运行只读 display 命令。',
  properties: {
    lab: str('实验 id，例如 vlan-basic'),
    bindings: arr(obj({ role: str('拓扑角色，例如 SW1'), device: str('真实设备 id') }), '角色到设备的绑定'),
    timeoutMs: int('每条检查命令超时，默认 12000ms'),
  },
  required: ['lab', 'bindings'],
  timeoutMs: 180000,
  outputSchema: VERIFY_OUTPUT,
  async execute(args) {
    const lab = findLab(args.lab)
    if (!lab) throw new Error(`找不到实验 "${args.lab || ''}"。先运行 netlab_lab action=list。`)
    if (!Array.isArray(args.bindings)) throw new Error('bindings 必须是数组')
    const mapping = new Map(args.bindings.map((item) => [String(item.role), String(item.device)]))
    const devices = await readDevices()
    const results = []
    for (const check of lab.verify) {
      const ref = mapping.get(check.role)
      if (!ref) {
        results.push({ role: check.role, command: check.command, status: 'skip', detail: '未绑定设备' })
        continue
      }
      try {
        const device = findDevice(devices, ref)
        const session = await getSession(device)
        const timeoutMs = Math.max(3000, Math.min(Number(args.timeoutMs) || 12000, 60000))
        const [result] = await session.exec([check.command], { timeoutMs })
        const output = result?.output || ''
        const pass = new RegExp(check.expect, 'm').test(output) && (!check.reject || !new RegExp(check.reject, 'm').test(output))
        results.push({
          role: check.role,
          command: check.command,
          status: pass ? 'pass' : 'fail',
          detail: pass ? '匹配预期输出' : check.hint || '输出未匹配预期',
          output: output.slice(0, 1200),
        })
      } catch (error) {
        results.push({
          role: check.role,
          command: check.command,
          status: 'fail',
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const value = { ok: results.every((item) => item.status === 'pass'), results }
    return { ...value, markdown: verifyMarkdown(lab, results) }
  },
})

const quizTool = tool({
  name: 'netlab_quiz',
  description: '生成或批改网络工程选择题。覆盖 VLAN、STP、OSPF、路由、NAT、ACL、DHCP、ARP、子网划分；也可 action=fault 针对某个故障案例出配套题。',
  properties: {
    action: { type: 'string', enum: ['new', 'grade', 'topics', 'fault'], description: 'new/grade/topics/fault' },
    topics: arr(str('主题，例如 VLAN'), '限定主题；不传则随机'),
    count: int('题目数量，1-10，默认 5'),
    quizId: str('grade 时的测验 id'),
    answers: arr(str('按题号顺序的答案，例如 B / 2'), 'grade 时的答案数组'),
    fault: str('action=fault 时的故障案例 id，例如 f01-vlan-mismatch'),
  },
  required: ['action'],
  timeoutMs: 15000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'topics') {
      const counts = QUIZ_TOPICS.map((topic) => `- ${topic}`)
      return { action, markdown: `# 可选题库主题\n\n${counts.join('\n')}\n\n用 \`netlab_quiz action=new topics=["OSPF"] count=5\` 生成。` }
    }
    if (action === 'new') {
      const quiz = createQuiz({ topics: args.topics, count: args.count })
      quizzes.set(quiz.id, quiz)
      if (quizzes.size > 50) {
        const oldest = quizzes.keys().next().value
        quizzes.delete(oldest)
      }
      return { action, markdown: quizMarkdownNew(quiz) }
    }
    if (action === 'fault') {
      const fault = findFault(args.fault)
      if (!fault) throw new Error(`找不到故障案例 ${args.fault || ''}。先运行 netlab_fault action=list`)
      const quiz = quizFromFault(fault)
      if (!quiz) throw new Error(`故障 ${fault.id} 没有配套题目，改用 action=new topics=[...]`)
      quizzes.set(quiz.id, quiz)
      return { action, markdown: `# 故障配套题：${fault.title}\n\n${quizPlanMarkdown(fault, quiz).trim()}` }
    }
    if (action === 'grade') {
      const quiz = quizzes.get(String(args.quizId || ''))
      if (!quiz) throw new Error('找不到该 quizId；请先 action=new 生成测验')
      const result = gradeQuiz(quiz, args.answers || [])
      quizzes.delete(quiz.id)
      return { action, markdown: quizMarkdownGrade(result) }
    }
    throw new Error(`未知 action：${action}`)
  },
})

async function runOn(bindings, role, commands, timeoutMs) {
  const mapping = new Map((bindings || []).map((item) => [String(item.role), String(item.device)]))
  const ref = mapping.get(role)
  if (!ref) throw new Error(`角色 ${role} 没有绑定设备，请在 bindings 里补上`)
  const devices = await readDevices()
  const device = findDevice(devices, ref)
  const session = await getSession(device)
  const results = await session.exec(commands, { timeoutMs })
  return results.map((item) => ({
    role,
    command: item.command,
    output: item.output,
    ok: item.ok,
  }))
}

const curriculumTool = tool({
  name: 'netlab_curriculum',
  description: 'HCIA-Datacom 实验学习路线：10 个阶段由易到难，查看进度、下一阶段、阶段详情、标记完成。进度持久化到本地文件，重启 DSH 不丢失。',
  properties: {
    action: { type: 'string', enum: ['list', 'progress', 'next', 'phase', 'complete', 'reset', 'note'], description: 'list/progress/next/phase/complete/reset/note' },
    phase: str('阶段 id，例如 phase-2'),
    note: str('note 时写入的阶段备注，例如“VLAN 已掌握，trunk 还需练”'),
  },
  required: ['action'],
  timeoutMs: 15000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'list') {
      return { action, markdown: routeMarkdown() }
    }
    if (action === 'progress') {
      const completed = [...completedPhases]
      const progress = computeProgress(completed)
      const parts = [
        '# HCIA 学习进度',
        `已完成 **${progress.done}/${progress.total}**（${progress.percent}%）`,
        '',
        '```text',
        ...CURRICULUM.map((phase) => `${completedPhases.has(phase.id) ? '[x]' : '[ ]'} ${phase.id}  ${phase.title}`),
        '```',
        '',
        `进度文件：\`${resolveProgressPath()}\``,
      ]
      const next = nextPhase(completed)
      if (next) parts.push('', `下一阶段：**${next.title}**，用 \`netlab_curriculum action=phase phase=${next.id}\``)
      else parts.push('', '全部阶段已完成，建议每天用 `netlab_quiz` 保持题感。')
      return { action, markdown: parts.join('\n') }
    }
    if (action === 'next') {
      const next = nextPhase([...completedPhases])
      if (!next) return { action, markdown: '所有阶段已完成。建议：`netlab_quiz action=new count=10` 做一套综合测验。' }
      return { action, markdown: phaseMarkdown(next, { index: CURRICULUM.indexOf(next) }) }
    }
    if (action === 'phase') {
      const phase = findPhase(args.phase)
      if (!phase) {
        throw new Error(`找不到阶段 ${args.phase || ''}。可用：${listPhases().map((item) => item.id).join(', ')}`)
      }
      const saved = await readProgressQueued().catch(() => null)
      const note = saved?.notes?.[phase.id]
      const body = phaseMarkdown(phase)
      return {
        action,
        markdown: note ? `${body}\n\n---\n\n**我的备注**：${note}` : body,
      }
    }
    if (action === 'complete') {
      const phase = findPhase(args.phase)
      if (!phase) throw new Error(`找不到阶段 ${args.phase || ''}`)
      // Derive the saved set from disk so a startup load still in flight cannot
      // clobber this write; the in-memory set only reflects this session.
      const saved = await readProgressQueued().catch(() => emptyProgress())
      const next = new Set([...saved.completed, ...completedPhases, phase.id])
      completedPhases.add(phase.id)
      await writeProgress({ completed: [...next] })
      return {
        action,
        markdown: `已标记完成：**${phase.title}**\n\n当前进度 ${next.size}/${CURRICULUM.length}，已写入 \`${resolveProgressPath()}\`。用 \`netlab_curriculum action=next\` 看下一阶段。`,
      }
    }
    if (action === 'reset') {
      completedPhases.clear()
      await writeProgress({ completed: [] })
      return { action, markdown: '学习进度已清空（完成标记），阶段备注仍保留。' }
    }
    if (action === 'note') {
      const phase = findPhase(args.phase)
      if (!phase) throw new Error(`找不到阶段 ${args.phase || ''}`)
      if (!args.note || !String(args.note).trim()) throw new Error('note 不能为空')
      const note = String(args.note).trim().slice(0, 500)
      await writeProgress({ notes: { [phase.id]: note } })
      return { action, markdown: `已记录 ${phase.id} 的备注：${note}` }
    }
    throw new Error(`未知 action：${action}`)
  },
})

/** Load saved progress at startup so a restart keeps the learner's place. */
async function loadSavedProgress() {
  try {
    const saved = await readProgress()
    completedPhases.clear()
    for (const id of saved.completed) completedPhases.add(id)
    return saved
  } catch {
    return emptyProgress()
  }
}

const faultTool = tool({
  name: 'netlab_fault',
  description: 'HCIA 故障排查案例库：按难度/层级筛选，查看症状和分层排查步骤；学习模式不给答案，answer 才给根因。可选把故障注入设备（需用户同意）。',
  properties: {
    action: { type: 'string', enum: ['list', 'show', 'answer', 'diagnose'], description: 'list/show/answer/diagnose' },
    id: str('案例 id，例如 f01-vlan-mismatch；show 不传则随机'),
    level: str('list 时按难度过滤：初级/中级/高级'),
    layer: str('list 时按层级过滤：二层/三层/策略/DHCP'),
    inject: bool('是否把故障注入到设备（会改配置，需用户明确同意）'),
    bindings: arr(obj({ role: str('角色'), device: str('设备 id') }), '角色到设备绑定，inject 时必填'),
    quiz: bool('是否附带 3-4 道配套题（练完就测），默认 true；纯看案例可传 false'),
  },
  required: ['action'],
  timeoutMs: 120000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'list') {
      return { action, markdown: faultIndexMarkdown(listFaults({ level: args.level, layer: args.layer })) }
    }
    if (action === 'diagnose') {
      return { action, markdown: diagnosisMarkdown() }
    }
    const wanted = args.id ? findFault(args.id) : FAULTS[Math.floor(Math.random() * FAULTS.length)]
    if (!wanted) throw new Error(`找不到故障案例 ${args.id}`)
    const withQuiz = args.quiz !== false
    const attachQuiz = (fault) => {
      if (!withQuiz) return ''
      const quiz = quizFromFault(fault)
      if (quiz) quizzes.set(quiz.id, quiz)
      return quizPlanMarkdown(fault, quiz)
    }
    if (action === 'answer') {
      let injected = ''
      if (args.inject) {
        if (!args.bindings || !args.bindings.length) throw new Error('inject=true 时必须提供 bindings')
        const lines = []
        for (const block of wanted.inject || []) {
          const results = await runOn(args.bindings, block.role, block.commands, 12000)
          lines.push(...results.map((item) => `${item.role} ${item.command} → ${item.ok ? 'ok' : '错误'}\n${item.output}`))
        }
        injected = `\n\n## 已注入故障\n\`\`\`text\n${lines.join('\n')}\n\`\`\`\n现在是真实的故障环境，请自己先排再问我。`
      }
      return { action, markdown: faultMarkdown(wanted, { teaching: false }) + injected + attachQuiz(wanted) }
    }
    if (action === 'show') {
      return { action, markdown: faultMarkdown(wanted, { teaching: true }) + attachQuiz(wanted) }
    }
    throw new Error(`未知 action：${action}`)
  },
})

const skillCheckTool = tool({
  name: 'netlab_skillcheck',
  description: 'HCIA 能力自检：针对指定阶段或全部阶段生成检查清单与自测题，评估薄弱环节并给出补强建议。',
  properties: {
    phase: str('阶段 id；不传则检查全部'),
  },
  required: [],
  timeoutMs: 15000,
  async execute(args) {
    const phases = args.phase ? [findPhase(args.phase)].filter(Boolean) : CURRICULUM
    if (!phases.length) throw new Error(`找不到阶段 ${args.phase || ''}`)
    const parts = ['# HCIA 能力自检']
    for (const phase of phases) {
      parts.push(`## ${phase.title}`, `目标：${phase.goal}`, '', '检查清单：', ...phase.checklist.map((item) => `- [ ] ${item}`), '')
    }
    parts.push(
      '## 接下来',
      '回答以上清单时，对不确定的条目说"不确定"，我会用 `netlab_quiz` 出 5 道对应主题的题，并带你补概念。',
      '也可以直接说"开始", 我从第一个未掌握项开始。',
    )
    return { action: 'check', markdown: parts.join('\n') }
  },
})

const standardTool = tool({
  name: 'netlab_standard',
  description: '华为现场命名与编号规范：生成 sysname、接口 description 模板、VLAN 规划，或评审一段配置挑问题。进实验室第一课。',
  properties: {
    action: { type: 'string', enum: ['index', 'sysname', 'description', 'vlan', 'review'], description: 'index/sysname/description/vlan/review' },
    site: str('站点缩写，例如 BJ / SH / IDC'),
    role: str('设备角色，例如 CORE / AGG / ACC / FW / WAN'),
    index: int('序号，1-99'),
    name: str('要检查的 sysname'),
    config: str('review 时贴入的配置片段'),
  },
  required: ['action'],
  timeoutMs: 15000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'index') return { action, markdown: standardIndexMarkdown() }
    if (action === 'sysname') {
      const built = buildSysname({ site: args.site, role: args.role, index: args.index })
      return {
        action,
        markdown: [
          '# sysname 建议',
          `生成：\`${built}\``,
          '',
          '规则：<站点>-<角色>-<序号>。角色常见写法：WAN / FW / CORE / AGG / ACC / AP。',
          '现场只看设备名就要能判断它在哪个站点、做什么，不要写 SW1、huawei、test 这种名字。',
        ].join('\n'),
      }
    }
    if (action === 'description') return { action, markdown: descriptionRulesMarkdown() }
    if (action === 'vlan') return { action, markdown: vlanPlanMarkdown() }
    if (action === 'review') {
      if (!args.config || !String(args.config).trim()) throw new Error('review 需要传入 config')
      const findings = reviewConfig(args.config)
      return { action, markdown: reviewMarkdown(args.config, findings) }
    }
    throw new Error(`未知 action：${action}`)
  },
})

const checklistTool = tool({
  name: 'netlab_checklist',
  description: '变更检查卡：变更前/中/后排障检查清单，或按实验生成专属检查表。带命令和红线，避免漏保存、漏回滚点。',
  properties: {
    action: { type: 'string', enum: ['list', 'show', 'lab'], description: 'list/show/lab' },
    id: str('检查卡 id：before-change / during-change / after-change / troubleshoot'),
    lab: str('实验 id，用于生成该实验的检查表'),
  },
  required: ['action'],
  timeoutMs: 15000,
  async execute(args) {
    const action = String(args.action)
    if (action === 'list') return { action, markdown: checklistIndexMarkdown() }
    if (action === 'show') {
      const check = findChecklist(args.id)
      if (!check) throw new Error(`找不到检查卡 ${args.id || ''}。可用：${listChecklists().map((item) => item.id).join(', ')}`)
      return { action, markdown: checklistMarkdown(args.id) }
    }
    if (action === 'lab') {
      const lab = findLab(args.lab)
      if (!lab) throw new Error(`找不到实验 ${args.lab || ''}。先运行 netlab_lab action=list`)
      return { action, markdown: checklistForLab(lab) }
    }
    throw new Error(`未知 action：${action}`)
  },
})

const referenceTool = tool({
  name: 'netlab_reference',
  description: '查询华为 VRP / eNSP 常用配置：VLAN、静态路由、OSPF、NAT、ACL、DHCP、STP 和分层排障；也可 topic=pitfall 检索 20 个 eNSP 踩坑经验，或直接贴报错自动匹配。',
  properties: {
    topic: str('主题 id：vlan/static-route/ospf/nat/acl/dhcp/stp/troubleshoot/pitfall/all'),
    query: str('自由搜索关键词，例如 trunk、邻居、反掩码；也可以直接贴报错原文'),
  },
  required: [],
  timeoutMs: 15000,
  async execute(args) {
    const rawTopic = String(args.topic || '').trim().toLowerCase()
    if (rawTopic === 'pitfall' || rawTopic === 'pitfalls') {
      const key = String(args.query || '').trim()
      if (!key) return { action: 'pitfall-index', markdown: pitfallIndexMarkdown() }
      const byId = findPitfall(key)
      if (byId) return { action: 'pitfall', markdown: pitfallMarkdown(byId) }
      const matches = matchPitfalls(key, { limit: 5 })
      if (matches.length) return { action: 'pitfall-match', markdown: pitfallMatchMarkdown(matches) }
      const byText = listPitfalls().filter((item) =>
        item.title.includes(key) || item.hint.includes(key) || item.category.includes(key))
      if (byText.length) {
        return { action: 'pitfall-search', markdown: byText.map(pitfallMarkdown).join('\n\n---\n\n') }
      }
      return { action: 'pitfall-index', markdown: pitfallIndexMarkdown() }
    }

    const topic = getReference(args.topic)
    if (topic) return { action: 'topic', markdown: topic.body }
    // No explicit topic: still try a raw error message against the pitfall base.
    if (args.query) {
      const pitfallMatches = matchPitfalls(args.query, { limit: 3 })
      if (pitfallMatches.length) {
        return { action: 'pitfall-match', markdown: pitfallMatchMarkdown(pitfallMatches) }
      }
    }
    const matches = args.query ? searchReference(args.query) : []
    if (matches.length) {
      return {
        action: 'search',
        markdown: matches.map((item) => item.body).join('\n\n---\n\n'),
      }
    }
    const index = referenceIndex()
    return {
      action: 'index',
      markdown: `# 命令参考\n\n${index.map((item) => `- \`${item.id}\`：${item.title}（${item.keywords.join('、')}）`).join('\n')}\n\n用 \`netlab_reference topic=vlan\` 查看详细内容；\`netlab_reference topic=pitfall\` 查看 20 个 eNSP 踩坑经验。`,
    }
  },
})

export function apply(ctx) {
  const prompt = loadPrompt()
  if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
    ctx.systemPrompt.section({
      name: 'network-lab:coach',
      order: 2575,
      text: prompt,
    })
  }

  ctx.tools.register(devicesTool)
  ctx.tools.register(execTool)
  ctx.tools.register(rebootTool)
  ctx.tools.register(labTool)
  ctx.tools.register(verifyTool)
  ctx.tools.register(quizTool)
  ctx.tools.register(referenceTool)
  ctx.tools.register(curriculumTool)
  ctx.tools.register(faultTool)
  ctx.tools.register(skillCheckTool)
  ctx.tools.register(standardTool)
  ctx.tools.register(checklistTool)

  void loadSavedProgress()

  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => closeAllSessions())
  }
}

export const __test = {
  devicesTool,
  execTool,
  rebootTool,
  labTool,
  verifyTool,
  quizTool,
  referenceTool,
  curriculumTool,
  faultTool,
  skillCheckTool,
  standardTool,
  checklistTool,
  completedPhases,
  loadSavedProgress,
  closeAllSessions,
  sessionList,
  scanPorts,
  sessionKey,
  SESSION_IDLE_MS,
}
