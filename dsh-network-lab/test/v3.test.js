import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'
import { PITFALLS, matchPitfalls, pitfallIndexMarkdown, pitfallMarkdown } from '../lib/knowledge.js'
import { FAULT_QUIZ, quizFromFault, faultQuizPlan } from '../lib/faultquiz.js'
import { FAULTS } from '../lib/faults.js'

async function withEnv(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-v3-'))
  const prevDevices = process.env.DSH_NETLAB_DEVICES
  const prevProgress = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  apply({
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  })
  __test.completedPhases.clear()
  try {
    await fn(dir)
  } finally {
    if (prevDevices === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = prevDevices
    if (prevProgress === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = prevProgress
    __test.completedPhases.clear()
    await rm(dir, { recursive: true, force: true })
  }
}

/** Mock console: answers display/reboot, and can simulate a device that drops on reboot. */
function mockConsole({ supportsReboot = true, savedSysname = 'SW1', currentSysname = 'SW1', rebootRecovers = false } = {}) {
  let recovered = false
  return new Promise((resolve) => {
    // A recovered device still accepts new console sessions on the same port.
    const server = net.createServer((socket) => {
      if (rebootRecovers && recovered) {
        socket.write('\r\n<Huawei>')
        socket.on('data', (chunk) => {
          const text = [...chunk].filter((b) => b === 10 || b === 13 || b >= 32).map((b) => String.fromCharCode(b)).join('')
          for (const line of text.split('\n').map((item) => item.replace(/\r/g, '').trim()).filter(Boolean)) {
            if (line === 'screen-length 0 temporary') socket.write('\r\n<Huawei>')
            else if (line === 'display version') socket.write('\r\nHuawei S5700 VRP (R) software, Version 5.170\r\n<Huawei>')
            else if (line === 'display current-configuration | include sysname') socket.write(`\r\nsysname ${savedSysname}\r\n<Huawei>`)
            else socket.write(`\r\n${line}\r\n<Huawei>`)
          }
        })
        return
      }
      let buffer = ''
      socket.write('\r\n<Huawei>')
      socket.on('data', (chunk) => {
        const text = [...chunk].filter((b) => b === 10 || b === 13 || b >= 32).map((b) => String.fromCharCode(b)).join('')
        buffer += text
        let at
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).replace(/\r/g, '').trim()
          buffer = buffer.slice(at + 1)
          if (!line) continue
          if (line === 'screen-length 0 temporary') socket.write('\r\n<Huawei>')
          else if (line === 'display current-configuration | include sysname') {
            socket.write(`\r\n${line}\r\nsysname ${currentSysname}\r\n<Huawei>`)
          } else if (line === 'display saved-configuration | include sysname') {
            socket.write(`\r\n${line}\r\nsysname ${savedSysname}\r\n<Huawei>`)
          } else if (line === 'display startup') {
            socket.write('\r\nMainBoard Startup Configuration File: flash:/vrpcfg.zip\r\n<Huawei>')
          } else if (line === 'display version') {
            socket.write('\r\nHuawei S5700 VRP (R) software, Version 5.170\r\n<Huawei>')
          } else if (line === 'reboot') {
            if (!supportsReboot) {
              socket.write('\r\nError: Reboot is not permitted.\r\n<Huawei>')
              continue
            }
            socket.write('\r\nInfo: The system is comparing the configuration, please wait.\r\nAre you sure to continue?[Y/N]')
          } else if (line === 'y') {
            socket.write('\r\nNow rebooting...\r\n')
            setTimeout(() => { try { socket.destroy() } catch { /* ignore */ } }, 30)
            if (rebootRecovers) setTimeout(() => { recovered = true }, 200)
          } else {
            socket.write(`\r\n${line}\r\n<Huawei>`)
          }
        }
      })
    })
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

// ---------- 1. pitfall knowledge base ----------

test('pitfall library bundles 20 entries with fix guidance', () => {
  assert.equal(PITFALLS.length, 20)
  for (const item of PITFALLS) {
    assert.ok(item.title, `${item.id} title`)
    assert.ok(item.fix.length > 0, `${item.id} fix`)
    assert.ok(item.check.length > 0, `${item.id} check`)
  }
})

test('pitfall matcher maps real VRP errors to the right pitfall', () => {
  const cases = [
    ['Error: Unrecognized command found at "^" position.', 'p03-view-mismatch'],
    ['connect ECONNREFUSED 127.0.0.1:2000', 'p02-port-busy'],
    ['Wrong parameter found at "^" position.', 'p04-interface-missing'],
    ['Are you sure to continue?[Y/N]', 'p06-save-confirm'],
  ]
  for (const [text, expected] of cases) {
    const ids = matchPitfalls(text).map((item) => item.pitfall.id)
    assert.ok(ids.includes(expected), `${text} → ${expected}, got ${ids.join(',')}`)
  }
})

test('exec failure output carries pitfall hints', async () => {
  await withEnv(async () => {
    const { server, port } = await new Promise((resolve) => {
      const s = net.createServer((socket) => {
        let buf = ''
        socket.write('\r\n<Huawei>')
        socket.on('data', (chunk) => {
          const text = [...chunk].filter((b) => b === 10 || b === 13 || b >= 32).map((b) => String.fromCharCode(b)).join('')
          buf += text
          let at
          while ((at = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, at).replace(/\r/g, '').trim()
            buf = buf.slice(at + 1)
            if (!line) continue
            if (line === 'screen-length 0 temporary') socket.write('\r\n<Huawei>')
            else socket.write(`\r\n${line}\r\nError: Unrecognized command found at "^" position.\r\n<Huawei>`)
          }
        })
      })
      s.listen(0, '127.0.0.1', () => resolve({ server: s, port: s.address().port }))
    })
    try {
      const result = await __test.execTool.execute({
        device: `127.0.0.1:${port}`,
        commands: ['interface GigabitEthernet0/0/1'],
      })
      assert.equal(result.ok, false)
      assert.match(result.markdown, /你可能踩了这些坑/)
      assert.match(result.markdown, /提示符不对就是视图不对/)
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})

test('netlab_reference answers pitfall queries', async () => {
  await withEnv(async () => {
    const index = await __test.referenceTool.execute({ topic: 'pitfall' })
    assert.match(index.markdown, /踩坑知识库/)
    const detail = await __test.referenceTool.execute({ topic: 'pitfall', query: 'p03-view-mismatch' })
    assert.match(detail.markdown, /提示符不对就是视图不对/)
    const raw = await __test.referenceTool.execute({ query: 'Wrong parameter found at "^" position.' })
    assert.match(raw.markdown, /你可能踩了这些坑/)
  })
})

test('pitfall markdown shapes are stable', () => {
  assert.match(pitfallIndexMarkdown(), /\| id \| 分类 \| 坑 \|/)
  assert.match(pitfallMarkdown(PITFALLS[0]), /## /)
})

// ---------- 2. fault → quiz bridge ----------

test('every fault binds to quiz questions that exist in the bank', () => {
  const ids = new Set()
  for (const fault of FAULTS) {
    const plan = faultQuizPlan(fault)
    assert.ok(plan.questions.length > 0, `${fault.id} 应有配套题`)
    for (const question of plan.questions) ids.add(question.id)
    if (FAULT_QUIZ[fault.id]) assert.equal(plan.source, 'bound', `${fault.id} 使用显式绑定`)
  }
  assert.ok(ids.size >= 15, `题目覆盖面 ${ids.size}`)
})

test('quizFromFault produces a gradeable quiz', async () => {
  const fault = FAULTS.find((item) => item.id === 'f01-vlan-mismatch')
  const quiz = quizFromFault(fault)
  assert.equal(quiz.questions.length, 3)
  assert.equal(quiz.answers.length, 3)
  const { gradeQuiz } = await import('../lib/quiz.js')
  const worst = gradeQuiz(quiz, ['A', 'A', 'A'])
  assert.equal(worst.total, 3)
  const best = gradeQuiz(quiz, quiz.answers.map((answer) => String.fromCharCode(65 + answer)))
  assert.equal(best.score, 3)
})

test('netlab_fault attaches a quiz by default and can be disabled', async () => {
  await withEnv(async () => {
    const withQuiz = await __test.faultTool.execute({ action: 'show', id: 'f01-vlan-mismatch' })
    assert.match(withQuiz.markdown, /练完就测/)
    const noQuiz = await __test.faultTool.execute({ action: 'show', id: 'f01-vlan-mismatch', quiz: false })
    assert.doesNotMatch(noQuiz.markdown, /练完就测/)
  })
})

test('netlab_quiz action=fault then grades the attached quiz', async () => {
  await withEnv(async () => {
    const created = await __test.quizTool.execute({ action: 'fault', fault: 'f04-ospf-area' })
    const quizId = /quizId=(quiz-[^\s]+)/.exec(created.markdown)?.[1]
    assert.ok(quizId, '输出应包含 quizId')
    const graded = await __test.quizTool.execute({ action: 'grade', quizId, answers: ['B', 'A', 'A'] })
    assert.match(graded.markdown, /得分/)
  })
})

// ---------- 3. safe reboot ----------

test('netlab_reboot preflight lists save state and does not reboot', async () => {
  await withEnv(async () => {
    const { server, port } = await mockConsole({ currentSysname: 'SW1', savedSysname: 'SW1' })
    try {
      const result = await __test.rebootTool.execute({ device: `127.0.0.1:${port}`, phase: 'preflight' })
      assert.match(result.markdown, /可以重启/)
      assert.match(result.markdown, /✅ 一致/)
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})

test('netlab_reboot preflight blocks when config is not saved', async () => {
  await withEnv(async () => {
    const { server, port } = await mockConsole({ currentSysname: 'TEMP-TEST', savedSysname: 'SW1' })
    try {
      const result = await __test.rebootTool.execute({ device: `127.0.0.1:${port}`, phase: 'preflight' })
      assert.match(result.markdown, /不建议现在重启/)
      assert.match(result.markdown, /❌ 不一致/)
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})

test('netlab_reboot refuses the reboot phase without confirm', async () => {
  await withEnv(async () => {
    const { server, port } = await mockConsole()
    try {
      await assert.rejects(
        () => __test.rebootTool.execute({ device: `127.0.0.1:${port}`, phase: 'reboot' }),
        /confirm=true/,
      )
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})

test('netlab_reboot blocks the reboot phase when a late unsaved change appears', async () => {
  await withEnv(async () => {
    const { server, port } = await mockConsole({ currentSysname: 'TEMP-TEST', savedSysname: 'SW1' })
    try {
      await assert.rejects(
        () => __test.rebootTool.execute({ device: `127.0.0.1:${port}`, phase: 'reboot', confirm: true }),
        /不一致/,
      )
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})

test('netlab_reboot handles a device that refuses to reboot', async () => {
  await withEnv(async () => {
    const { server, port } = await mockConsole({ supportsReboot: false })
    try {
      const started = Date.now()
      const result = await __test.rebootTool.execute({
        device: `127.0.0.1:${port}`,
        phase: 'reboot',
        confirm: true,
        waitMs: 10000,
        check: ['display version'],
      })
      assert.match(result.markdown, /重启结果/)
      assert.ok(Date.now() - started < 12000, '拒绝重启时应快速返回，而不是耗尽 waitMs')
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})

test('reboot() reports a refused reboot without waiting for the deadline', async () => {
  const { TelnetSession } = await import('../lib/telnet.js')
  const { server, port } = await mockConsole({ supportsReboot: false })
  const session = new TelnetSession({ host: '127.0.0.1', port, commandTimeoutMs: 4000 })
  try {
    await session.connect()
    const started = Date.now()
    const result = await session.reboot({ timeoutMs: 30000 })
    assert.equal(result.ok, false)
    assert.equal(result.refused, true)
    assert.equal(result.disconnected, false)
    assert.ok(Date.now() - started < 5000, '应在收到错误提示符后立即返回')
  } finally {
    session.close()
    server.close()
  }
})

test('netlab_reboot completes a full reboot cycle on a compliant device', async () => {
  await withEnv(async () => {
    const { server, port } = await mockConsole({ rebootRecovers: true })
    try {
      const result = await __test.rebootTool.execute({
        device: `127.0.0.1:${port}`,
        phase: 'reboot',
        confirm: true,
        waitMs: 20000,
        check: ['display version', 'display current-configuration | include sysname'],
      })
      assert.match(result.markdown, /重启结果/)
      assert.match(result.markdown, /按预期断开了控制台连接/)
      assert.match(result.markdown, /重启后自检/)
      assert.match(result.markdown, /真正落盘/)
    } finally {
      __test.closeAllSessions()
      server.close()
    }
  })
})
