/**
 * Huawei field naming and numbering standards.
 * 老工程师的第一课：配置能不能被下一个人看懂，取决于命名。
 * 这里把现场常用规范做成可执行的检查/生成规则，而不是一句"要规范"。
 */

const RESERVED_VLANS = new Set([1, 1002, 1003, 1004, 1005, 4095])

/** Recommended VLAN number plan. Keep room between blocks so a new service fits. */
export const VLAN_PLAN = [
  { range: '2-99', purpose: '管理/运维 VLAN（带外管理、监控）' },
  { range: '100-199', purpose: '办公接入 VLAN（每部门一个）' },
  { range: '200-299', purpose: '服务器/生产 VLAN' },
  { range: '300-399', purpose: '互联/传输 VLAN（设备间点对点）' },
  { range: '400-499', purpose: '访客/无线 VLAN' },
  { range: '900-999', purpose: '预留/测试，禁止生产使用' },
]

export function vlanPlanMarkdown() {
  return [
    '# VLAN 编号规划建议',
    '',
    '| 编号段 | 用途 |',
    '| --- | --- |',
    ...VLAN_PLAN.map((row) => `| ${row.range} | ${row.purpose} |`),
    '',
    '**规则**：',
    '- VLAN 1 是默认 VLAN，生产不要承载业务。',
    '- VLAN 1002-1005 被保留，不能使用。',
    '- VLAN 4095 禁止使用。',
    '- 每段预留连续空间，新业务顺延编号，不要跳号乱填。',
    '- VLAN 号要与 IP 网段第三段对应（如 VLAN 110 ↔ 192.168.110.0/24），便于排障。',
  ].join('\n')
}

/**
 * Validate an interface alias used in `sysname`.
 * Recommended: <站点>-<角色>-<序号>, e.g. BJ-IDC-CORE-01 / SH-OFFICE-ACC-02
 */
export function checkSysname(name) {
  const value = String(name || '').trim()
  const issues = []
  const notes = []
  if (!value) {
    return { ok: false, issues: ['sysname 不能为空'], notes: [] }
  }
  if (value.length > 40) issues.push('sysname 建议不超过 40 个字符')
  if (/[^\x21-\x7e]/.test(value)) issues.push('sysname 只建议使用 ASCII 字符（字母数字和连字符），中文在部分日志/告警里会乱码')
  if (/\s/.test(value)) issues.push('sysname 不能包含空格')
  if (/^huawei$/i.test(value)) issues.push('默认 sysname Huawei 无法区分设备，必须修改')
  if (/^(sw|r|fw|ap)\d*$/i.test(value)) notes.push('形如 SW1/R1 的命名只适合实验；现场应带站点和角色，例如 BJ-IDC-CORE-01')
  const recommended = /^[A-Z]{2,4}(-[A-Z0-9]{2,8}){1,3}-\d{2}$/.test(value)
  if (!recommended && !/^(sw|r|fw|ap)\d*$/i.test(value)) {
    notes.push('推荐格式：<站点>-<角色>-<序号>，例如 BJ-IDC-CORE-01、SH-OFFICE-ACC-02')
  }
  return { ok: issues.length === 0, issues, notes, recommended }
}

/**
 * Build a conventional sysname from parts.
 */
export function buildSysname({ site = 'LAB', role = 'ACC', index = 1 } = {}) {
  const sitePart = String(site).trim().toUpperCase().slice(0, 4) || 'LAB'
  const rolePart = String(role).trim().toUpperCase().slice(0, 8) || 'ACC'
  const no = Math.max(0, Math.min(99, Number(index) || 1))
  return `${sitePart}-${rolePart}-${String(no).padStart(2, '0')}`
}

export const DESCRIPTION_RULES = [
  { key: 'to-device', format: 'To-<对端设备>-<对端接口>', example: 'To-SW2-GE0/0/24', use: '设备互联' },
  { key: 'to-user', format: 'To-<位置>-<用户/工位>-<VLAN>', example: 'To-3F-Desk-018-Vlan110', use: '接入 PC/AP' },
  { key: 'to-server', format: 'To-<服务器名>-<业务>', example: 'To-ERP-Server-3389', use: '服务器口' },
  { key: 'uplink', format: 'Uplink-To-<上游设备>-<接口>', example: 'Uplink-To-CORE1-GE1/0/1', use: '上联' },
]

export function descriptionRulesMarkdown() {
  const rows = [
    '| 场景 | 格式 | 示例 |',
    '| --- | --- | --- |',
    ...DESCRIPTION_RULES.map((rule) => `| ${rule.use} | \`${rule.format}\` | \`${rule.example}\` |`),
  ]
  return [
    '# 接口 description 规范',
    '',
    ...rows,
    '',
    '**规则**：',
    '- 每个上联口、互联口、接入口必须有 description。',
    '- 对端设备名写 sysname 的简写，不要写"交换机1"这种描述。',
    '- 端口带 "To-" 前缀，方便 `display interface description` 一眼扫到连接关系。',
    '- VLAN 号写进 description，trunk 口可写成 `Trunk-To-SW2-Vlan100-110`。',
  ].join('\n')
}

/**
 * Review a config snippet for common field-quality problems.
 * This is heuristic on purpose: it flags, the engineer decides.
 */
export function reviewConfig(text) {
  const source = String(text || '')
  const findings = []
  const add = (severity, issue, suggestion) => findings.push({ severity, issue, suggestion })

  const sysname = /sysname\s+(\S+)/.exec(source)
  if (!sysname) {
    add('error', '没有配置 sysname', '至少配置 sysname，避免默认 Huawei 无法区分设备')
  } else {
    const result = checkSysname(sysname[1])
    for (const issue of result.issues) add('error', `sysname: ${issue}`, '按 <站点>-<角色>-<序号> 命名')
    for (const note of result.notes) add('warn', `sysname: ${note}`, '实验可用 SW1，现场必须带站点')
  }

  const descriptions = (source.match(/^\s*description\s+\S+/gm) || []).length
  const interfaces = (source.match(/^interface\s+\S+/gm) || []).length
  if (interfaces > 0 && descriptions < Math.max(1, Math.floor(interfaces / 2))) {
    add('warn', `共 ${interfaces} 个接口，只有 ${descriptions} 个配了 description`, '互联口和上联口必须写 To-<对端>-<端口>')
  }

  if (/\bdescription\s+.{40,}/.test(source)) {
    add('info', '有 description 超过 40 字符', 'description 建议简短，详细说明放到变更单')
  }

  for (const line of source.split(/\r?\n/)) {
    const vlan = /^\s*vlan batch\s+(.+)$/.exec(line)
    if (vlan) {
      const numbers = vlan[1].split(/\s+/).map((item) => (item.includes('to') ? item : item)).filter(Boolean)
      for (const token of numbers) {
        const [from, to] = token.split(/[-/]/).map(Number)
        const list = Number.isFinite(to) ? [from, to] : [from]
        for (const number of list) {
          if (RESERVED_VLANS.has(number)) add('error', `使用了保留 VLAN ${number}`, '2-1001 之外的编号按规划替换')
        }
      }
    }
  }

  if (/\bport trunk allow-pass vlan (all|1 to 4094)\b/i.test(source)) {
    add('warn', 'trunk 放行 all，等于把全公司 VLAN 打通', '显式列出需要的 VLAN，例如 allow-pass vlan 100 110 200')
  }
  if (/\bport default vlan\s+1\b/.test(source)) {
    add('warn', '接入口仍在默认 VLAN 1', '按规划划入业务 VLAN')
  }
  if (/\bip address\s+(192\.168\.\d+\.\d+)\s+255\.255\.0\.0\b/.test(source)) {
    add('warn', '/16 大二层网段，容易与相邻站点冲突', '生产环境按 /24 或更细规划')
  }
  if (/\b(192\.168\.0\.1|192\.168\.1\.1|10\.0\.0\.1)\b/.test(source) && !/description/.test(source)) {
    add('info', '出现了常见默认网关地址', '确认网关地址是否符合本站点编址规划')
  }
  if (/\bip route-static\s+0\.0\.0\.0\s+0\.0\.0\.0\b/.test(source) && !/describe|默认路由/.test(source)) {
    add('info', '存在缺省路由', '缺省路由影响面广，变更需在变更单记录下一跳和目的')
  }
  if (/\bundo\s+stp\s+enable\b/.test(source)) {
    add('error', '配置了关闭 STP', '生产环境禁止关闭 STP，否则可能广播风暴')
  }
  if (/\bport\s+hybrid\s+tagged\s+vlan\s+/.test(source) && /\baccess\b/.test(source)) {
    add('info', '同时出现 hybrid tagged 与 access', '确认不是接口类型混配')
  }

  if (!/^\s*save\b/m.test(source) && /^\s*system-view\b/m.test(source) && !/display current-configuration/.test(source)) {
    add('info', '配置片段未包含保存提示', '变更后记得 save，并对比 display current 与 display saved')
  }

  return findings
}

export function reviewMarkdown(source, findings) {
  const errors = findings.filter((item) => item.severity === 'error').length
  const warns = findings.filter((item) => item.severity === 'warn').length
  const infos = findings.filter((item) => item.severity === 'info').length
  const lines = [
    '# 配置规范检查',
    `问题：**${errors} 个错误**、${warns} 个警告、${infos} 个提示`,
    '',
  ]
  if (!findings.length) {
    lines.push('没有发现明显问题。仍建议按《变更检查卡》走一遍。')
  } else {
    lines.push('| 级别 | 问题 | 建议 |', '| --- | --- | --- |')
    for (const item of findings) {
      const badge = item.severity === 'error' ? '❌ 错误' : item.severity === 'warn' ? '⚠️ 警告' : 'ℹ️ 提示'
      lines.push(`| ${badge} | ${item.issue.replace(/\|/g, '\\|')} | ${item.suggestion.replace(/\|/g, '\\|')} |`)
    }
  }
  lines.push('', '> 这是启发式检查，不替代人工评审；`error` 级问题建议改完再上设备。')
  return lines.join('\n')
}

export function standardIndexMarkdown() {
  return [
    '# 华为现场命名与编号规范',
    '',
    '| 主题 | 说明 |',
    '| --- | --- |',
    '| `sysname` | <站点>-<角色>-<序号>，例如 BJ-IDC-CORE-01 |',
    '| `interface description` | To-<对端设备>-<对端接口> / To-<位置>-<用户>-<Vlan> |',
    '| VLAN 规划 | 管理/办公/服务器/互联/访客分段编号 |',
    '| 配置评审 | 把配置贴进 `netlab_standard action=review` 自动挑毛病 |',
    '',
    '用法：',
    '- `netlab_standard action=sysname site=BJ role=CORE index=1` 生成命名',
    '- `netlab_standard action=description` 看接口描述规范',
    '- `netlab_standard action=vlan` 看 VLAN 编号规划',
    '- `netlab_standard action=review` 贴配置做检查',
  ].join('\n')
}
