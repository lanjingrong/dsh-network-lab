import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { apply, __test } from '../index.js'
import { readProgress, writeProgress, resolveProgressPath } from '../lib/store.js'

function fakeContext() {
  const ctx = {
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  }
  apply(ctx)
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-progress-'))
  const previousDevices = process.env.DSH_NETLAB_DEVICES
  const previousProgress = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  __test.completedPhases.clear()
  try {
    await fn(dir)
  } finally {
    if (previousDevices === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = previousDevices
    if (previousProgress === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = previousProgress
    __test.completedPhases.clear()
    await rm(dir, { recursive: true, force: true })
  }
}

test('progress file lives beside devices and honours DSH_NETLAB_PROGRESS', () => {
  const env = { DSH_HOME: 'C:\\fake\\home' }
  assert.equal(resolveProgressPath(env), path.join('C:\\fake\\home', 'network-lab', 'progress.json'))
  assert.equal(resolveProgressPath({ DSH_NETLAB_PROGRESS: 'D:\\x\\p.json' }), path.resolve('D:\\x\\p.json'))
})

test('complete writes progress.json and survives a simulated restart', async () => {
  await withTempDir(async (dir) => {
    fakeContext()
    await __test.curriculumTool.execute({ action: 'complete', phase: 'phase-0' })
    await __test.curriculumTool.execute({ action: 'complete', phase: 'phase-1' })

    const raw = JSON.parse(await readFile(path.join(dir, 'progress.json'), 'utf8'))
    assert.deepEqual(raw.completed.sort(), ['phase-0', 'phase-1'])
    assert.ok(raw.updatedAt)

    // Simulate a DSH restart: in-memory set is gone, loadSavedProgress restores it.
    __test.completedPhases.clear()
    await __test.loadSavedProgress()
    assert.deepEqual([...__test.completedPhases].sort(), ['phase-0', 'phase-1'])

    const progress = await __test.curriculumTool.execute({ action: 'progress' })
    assert.match(progress.markdown, /2\/10/)
    assert.match(progress.markdown, /progress\.json/)
  })
})

test('notes persist and appear on the phase page', async () => {
  await withTempDir(async () => {
    fakeContext()
    await __test.curriculumTool.execute({ action: 'note', phase: 'phase-2', note: 'trunk 放行顺序要再练' })
    const saved = await readProgress()
    assert.equal(saved.notes['phase-2'], 'trunk 放行顺序要再练')
    const page = await __test.curriculumTool.execute({ action: 'phase', phase: 'phase-2' })
    assert.match(page.markdown, /我的备注/)
    assert.match(page.markdown, /trunk 放行顺序要再练/)
  })
})

test('reset clears completions but keeps notes', async () => {
  await withTempDir(async () => {
    fakeContext()
    await __test.curriculumTool.execute({ action: 'complete', phase: 'phase-3' })
    await __test.curriculumTool.execute({ action: 'note', phase: 'phase-3', note: '静态路由 OK' })
    const reset = await __test.curriculumTool.execute({ action: 'reset' })
    assert.match(reset.markdown, /已清空/)
    const saved = await readProgress()
    assert.deepEqual(saved.completed, [])
    assert.equal(saved.notes['phase-3'], '静态路由 OK')
  })
})

test('corrupt progress file falls back to empty without throwing the plugin', async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, 'progress.json'), '{not json', 'utf8')
    __test.completedPhases.clear()
    const result = await __test.loadSavedProgress()
    assert.deepEqual(result.completed, [])
    fakeContext()
    const progress = await __test.curriculumTool.execute({ action: 'progress' })
    assert.match(progress.markdown, /0\/10/)
  })
})

test('writeProgress normalises unknown and duplicate entries', async () => {
  await withTempDir(async () => {
    const saved = await writeProgress({ completed: ['phase-1', 'phase-1', '', 42], notes: { 'phase-1': 'ok', bad: 1 } })
    assert.deepEqual(saved.completed, ['phase-1'])
    assert.deepEqual(saved.notes, { 'phase-1': 'ok' })
    assert.ok(saved.updatedAt)
  })
})

test('concurrent complete calls do not lose earlier phases', async () => {
  await withTempDir(async () => {
    fakeContext()
    await Promise.all([
      __test.curriculumTool.execute({ action: 'complete', phase: 'phase-0' }),
      __test.curriculumTool.execute({ action: 'complete', phase: 'phase-1' }),
      __test.curriculumTool.execute({ action: 'complete', phase: 'phase-2' }),
    ])
    const saved = await readProgress()
    assert.deepEqual(saved.completed.sort(), ['phase-0', 'phase-1', 'phase-2'])
  })
})

test('startup load racing a complete keeps the completed phase', async () => {
  await withTempDir(async () => {
    fakeContext()
    await writeProgress({ completed: ['phase-0', 'phase-1'] })
    __test.completedPhases.clear()
    // Fire the startup load and a completion together, as a fast DSH restart can.
    await Promise.all([
      __test.loadSavedProgress(),
      __test.curriculumTool.execute({ action: 'complete', phase: 'phase-2' }),
    ])
    const saved = await readProgress()
    assert.deepEqual(saved.completed.sort(), ['phase-0', 'phase-1', 'phase-2'])
  })
})
