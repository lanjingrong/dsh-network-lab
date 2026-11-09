import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'
import { CURRICULUM } from '../lib/curriculum.js'
import { LABS } from '../lib/labs.js'
import { FAULTS } from '../lib/faults.js'
import { phaseQuestionIds, phasePassLine, coverage, phaseOfLab, phaseOfFault } from '../lib/route-links.js'

function fakeContext() {
  const tools = []
  apply({
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  })
  return tools
}

test('every phase, lab, fault and question is wired into the route', () => {
  const cov = coverage()
  const orphanLabs = cov.labs.filter((item) => !item.phase)
  const orphanFaults = cov.faults.filter((item) => !item.phase)
  assert.deepEqual(orphanLabs, [], '每个实验都要挂在某个阶段上')
  assert.deepEqual(orphanFaults, [], '每个故障案例都要挂在某个阶段上')
  assert.equal(LABS.length, 10)
  assert.equal(FAULTS.length, 12)
  assert.equal(phaseOfLab('vlan-basic').id, 'phase-2')
  assert.equal(phaseOfFault('f04-ospf-area').id, 'phase-4')
})

test('every phase with questions has a lab to practise first', () => {
  for (const phase of CURRICULUM) {
    const ids = phaseQuestionIds(phase)
    if (ids.length) assert.ok(phasePassLine(phase, { labDone: false, percent: 100 }).lab, `${phase.id} 有题却无主实验`)
  }
})

test('a perfect quiz on the phase topics unlocks that phase', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-quiz-'))
  const previous = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  __test.completedPhases.clear()
  __test.quizzes.clear()
  __test.quizScores.clear()
  __test.labsRun.clear()
  try {
    fakeContext()
    const phase = CURRICULUM.find((item) => item.id === 'phase-2')
    assert.ok(phaseQuestionIds(phase).length > 0)
    const issued = await __test.quizTool.execute({ action: 'new', count: 10, topics: ['VLAN', 'Trunk', 'STP'] })
    const quizId = issued.markdown.match(/quiz-(?!action)[a-z0-9-]+/)[0]
    const key = __test.quizzes.get(quizId).answers.map((index) => 'ABCD'[index])
    const graded = await __test.quizTool.execute({ action: 'grade', quizId, answers: key })
    assert.match(graded.markdown, /过关/)
    assert.match(graded.markdown, /phase-2/)
  } finally {
    __test.completedPhases.clear()
    __test.quizzes.clear()
    __test.quizScores.clear()
    __test.labsRun.clear()
    if (previous === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('complete refuses a phase with an unrun lab, force overrides', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-route-'))
  const previous = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  try {
    fakeContext()
    const blocked = await __test.curriculumTool.execute({ action: 'complete', phase: 'phase-2' })
    assert.match(blocked.markdown, /还没过关/)
    const forced = await __test.curriculumTool.execute({ action: 'complete', phase: 'phase-2', force: true })
    assert.match(forced.markdown, /force 跳过校验/)
    const progress = await __test.curriculumTool.execute({ action: 'progress' })
    assert.match(progress.markdown, /已完成 \*\*1\/10\*\*/)
    assert.match(progress.markdown, /下一阶段/)
  } finally {
    await __test.curriculumTool.execute({ action: 'reset' }).catch(() => {})
    if (previous === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = previous
    await rm(dir, { recursive: true, force: true })
  }
})

function mockDevice() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buffer = ''
      socket.write('\r\n<Huawei>')
      socket.on('data', (chunk) => {
        buffer += [...chunk].filter((b) => b === 10 || b === 13 || b >= 32).map((b) => String.fromCharCode(b)).join('')
        let at
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).replace(/\r/g, '').trim()
          buffer = buffer.slice(at + 1)
          if (!line) continue
          if (line === 'display vlan') socket.write('\r\nVLAN ID: 10\r\nVLAN ID: 20\r\n<Huawei>')
          else if (line === 'display port vlan active') {
            socket.write('\r\nT=TAG U=UNTAG\r\nGigabitEthernet0/0/1  access  10  U: 10\r\nGigabitEthernet0/0/24 trunk  1  U: 1 T: 10 20\r\n<Huawei>')
          } else socket.write(`\r\n${line}\r\n<Huawei>`)
        }
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

test('a passing verify closes the lab half of a phase pass line', async () => {
  const { server, port } = await mockDevice()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-route2-'))
  const prevDev = process.env.DSH_NETLAB_DEVICES
  const prevProg = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  try {
    fakeContext()
    await __test.devicesTool.execute({ action: 'add', id: 'sw1', name: 'SW1', port })
    const verify = await __test.verifyTool.execute({
      lab: 'vlan-basic',
      bindings: [
        { role: 'SW1', device: 'sw1' },
        { role: 'SW2', device: 'sw1' },
      ],
    })
    assert.equal(verify.ok, true)
    assert.match(verify.markdown, /phase-2/)
    const phase = await __test.curriculumTool.execute({ action: 'phase', phase: 'phase-2' })
    assert.match(phase.markdown, /\[x\] 做完主实验/)
    assert.match(phase.markdown, /接下来|过关条件/)
  } finally {
    __test.closeAllSessions()
    if (prevDev === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = prevDev
    if (prevProg === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = prevProg
    await rm(dir, { recursive: true, force: true })
    server.close()
  }
})
