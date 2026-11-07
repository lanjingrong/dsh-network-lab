import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'

function fakeContext() {
  const tools = []
  const sections = []
  return {
    tools,
    sections,
    ctx: {
      tools: { register: (definition) => { tools.push(definition); return () => {} } },
      systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
      on: () => {},
    },
  }
}

test('apply registers twelve tools and the coach prompt', () => {
  const { ctx, tools, sections } = fakeContext()
  apply(ctx)
  assert.deepEqual(
    tools.map((item) => item.name).sort(),
    [
      'netlab_checklist',
      'netlab_curriculum',
      'netlab_devices',
      'netlab_exec',
      'netlab_fault',
      'netlab_lab',
      'netlab_quiz',
      'netlab_reboot',
      'netlab_reference',
      'netlab_skillcheck',
      'netlab_standard',
      'netlab_verify',
    ],
  )
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'network-lab:coach')
  assert.match(sections[0].text, /eNSP/)
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object')
    assert.equal(tool.parameters.additionalProperties, false)
    assert.equal(tool.output.schema.type, 'object')
    assert.equal(typeof tool.output.render, 'function')
    assert.equal(typeof tool.execute, 'function')
  }
})

test('lab, reference and quiz tools produce markdown', async () => {
  const { ctx } = fakeContext()
  apply(ctx)
  const lab = await __test.labTool.execute({ action: 'list' })
  assert.match(lab.markdown, /vlan-basic/)
  const shown = await __test.labTool.execute({ action: 'show', lab: 'vlan-basic' })
  assert.match(shown.markdown, /Trunk/)
  const solution = await __test.labTool.execute({ action: 'solution', lab: 'vlan-basic' })
  assert.match(solution.markdown, /port trunk allow-pass vlan 10 20/)
  const ref = await __test.referenceTool.execute({ topic: 'ospf' })
  assert.match(ref.markdown, /display ospf peer brief/)
  const quiz = await __test.quizTool.execute({ action: 'new', count: 3 })
  assert.match(quiz.markdown, /小测 quiz-/)
  const id = /小测 (quiz-[^\s]+)/.exec(quiz.markdown)[1]
  const graded = await __test.quizTool.execute({ action: 'grade', quizId: id, answers: ['A', 'B', 'C'] })
  assert.match(graded.markdown, /得分/)
})

test('device store add/list/remove does not expose passwords', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-'))
  const previous = process.env.DSH_NETLAB_DEVICES
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  try {
    const { ctx } = fakeContext()
    apply(ctx)
    const added = await __test.devicesTool.execute({
      action: 'add',
      id: 'sw1',
      name: 'SW1',
      port: 2000,
      username: 'admin',
      password: 'secret',
    })
    assert.match(added.markdown, /已添加/)
    assert.doesNotMatch(added.markdown, /secret/)
    const list = await __test.devicesTool.execute({ action: 'list' })
    assert.match(list.markdown, /sw1/)
    assert.doesNotMatch(list.markdown, /secret/)
    const removed = await __test.devicesTool.execute({ action: 'remove', id: 'sw1' })
    assert.match(removed.markdown, /已删除/)
  } finally {
    if (previous === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = previous
    await rm(dir, { recursive: true, force: true })
  }
})

test('exec tool refuses destructive commands without explicit confirmation', async () => {
  const { ctx } = fakeContext()
  apply(ctx)
  await assert.rejects(
    () => __test.execTool.execute({ device: '127.0.0.1:2000', commands: ['reboot'] }),
    /拒绝执行破坏性命令/,
  )
})
