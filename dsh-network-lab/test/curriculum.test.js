import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'
import { CURRICULUM, computeProgress, nextPhase } from '../lib/curriculum.js'
import { FAULTS, listFaults } from '../lib/faults.js'

function fakeContext() {
  const tools = []
  const ctx = {
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  }
  apply(ctx)
  return { tools }
}

/** Keep the real ~/.dsh untouched: every write goes to a throwaway directory. */
async function withIsolatedProgress(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-curriculum-'))
  const previous = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  __test.completedPhases.clear()
  try {
    await fn()
  } finally {
    if (previous === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = previous
    __test.completedPhases.clear()
    await rm(dir, { recursive: true, force: true })
  }
}

test('curriculum has 10 ordered phases covering VLAN to troubleshooting', () => {
  assert.equal(CURRICULUM.length, 10)
  const ids = CURRICULUM.map((phase) => phase.id)
  assert.deepEqual(ids, ['phase-0', 'phase-1', 'phase-2', 'phase-3', 'phase-4', 'phase-5', 'phase-6', 'phase-7', 'phase-8', 'phase-9'])
  for (const phase of CURRICULUM) {
    assert.ok(phase.title, `${phase.id} 有标题`)
    assert.ok(phase.concepts.length > 0, `${phase.id} 有概念`)
    assert.ok(phase.tasks.length > 0, `${phase.id} 有任务`)
  }
})

test('progress and next track completed phases', () => {
  assert.equal(computeProgress([]).done, 0)
  assert.equal(computeProgress(['phase-0', 'phase-1']).done, 2)
  assert.equal(nextPhase(['phase-0']).id, 'phase-1')
  assert.equal(nextPhase(CURRICULUM.map((p) => p.id)), null)
})

test('netlab_curriculum tools produce stable markdown', async () => {
  await withIsolatedProgress(async () => {
    fakeContext()
    const route = await __test.curriculumTool.execute({ action: 'list' })
    assert.match(route.markdown, /HCIA-Datacom 实验学习路线/)
    assert.match(route.markdown, /phase-2/)
    const phase = await __test.curriculumTool.execute({ action: 'phase', phase: 'phase-2' })
    assert.match(phase.markdown, /vlan-basic/)
    const progress = await __test.curriculumTool.execute({ action: 'progress' })
    assert.match(progress.markdown, /0\/10/)
    await __test.curriculumTool.execute({ action: 'complete', phase: 'phase-0', force: true })
    const after = await __test.curriculumTool.execute({ action: 'progress' })
    assert.match(after.markdown, /1\/10/)
    await __test.curriculumTool.execute({ action: 'reset' })
    const reset = await __test.curriculumTool.execute({ action: 'progress' })
    assert.match(reset.markdown, /0\/10/)
  })
})

test('fault library covers layers and teaching mode hides answers', async () => {
  assert.ok(FAULTS.length >= 7)
  assert.ok(listFaults({ level: '初级' }).length > 0)
  assert.ok(listFaults({ layer: '二层' }).length > 0)
  fakeContext()
  const show = await __test.faultTool.execute({ action: 'show', id: 'f01-vlan-mismatch' })
  assert.match(show.markdown, /## 分层排查/)
  assert.match(show.markdown, /## 学习模式/)
  assert.doesNotMatch(show.markdown, /## 根因/)
  const answer = await __test.faultTool.execute({ action: 'answer', id: 'f01-vlan-mismatch' })
  assert.match(answer.markdown, /## 根因/)
  assert.match(answer.markdown, /port trunk allow-pass vlan 10/)
  const list = await __test.faultTool.execute({ action: 'list' })
  assert.match(list.markdown, /f01-vlan-mismatch/)
})

test('skillcheck covers every phase checklist', async () => {
  fakeContext()
  const all = await __test.skillCheckTool.execute({})
  for (const phase of CURRICULUM) {
    assert.ok(all.markdown.includes(phase.title), `${phase.title} 出现在自检清单`)
  }
  const single = await __test.skillCheckTool.execute({ phase: 'phase-4' })
  assert.doesNotMatch(single.markdown, /第 2 阶段/)
})
