import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'
import { LABS } from '../lib/labs.js'
import { FAULTS } from '../lib/faults.js'
import { CURRICULUM } from '../lib/curriculum.js'
import { checkSysname, reviewConfig } from '../lib/standard.js'
import { CHECKLISTS } from '../lib/checklist.js'

async function withIsolatedEnv(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-teach-'))
  const prevDevices = process.env.DSH_NETLAB_DEVICES
  const prevProgress = process.env.DSH_NETLAB_PROGRESS
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  process.env.DSH_NETLAB_PROGRESS = path.join(dir, 'progress.json')
  const ctx = {
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  }
  apply(ctx)
  __test.completedPhases.clear()
  try {
    await fn()
  } finally {
    if (prevDevices === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = prevDevices
    if (prevProgress === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = prevProgress
    __test.completedPhases.clear()
    await rm(dir, { recursive: true, force: true })
  }
}

test('all 12 tools register with valid schemas', () => {
  const tools = []
  apply({
    tools: { register: (definition) => { tools.push(definition); return () => {} } },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  })
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
  for (const tool of tools) {
    assert.equal(tool.parameters.type, 'object', `${tool.name} parameters`)
    assert.equal(tool.parameters.additionalProperties, false, `${tool.name} additionalProperties`)
    assert.equal(tool.output.schema.type, 'object', `${tool.name} output`)
  }
})

test('labs carry device requirements, prerequisites and field-quality hints', () => {
  assert.equal(LABS.length, 10)
  for (const lab of LABS) {
    assert.ok(lab.devices, `${lab.id} 必须有设备要求`)
    assert.ok(lab.prereq, `${lab.id} 必须有前置知识`)
    assert.ok(lab.solution.every((block) => block.commands.some((cmd) => cmd === 'system-view')), `${lab.id} 参考配置要有 system-view`)
  }
  const networkLabs = LABS.filter((lab) => lab.id !== 'save-compare')
  assert.ok(networkLabs.every((lab) => lab.solution.some((block) => block.commands.some((cmd) => cmd.startsWith('description ')))), '互联类实验应有 description')
  assert.ok(LABS.some((lab) => lab.id === 'aaa-telnet'))
  assert.ok(LABS.some((lab) => lab.id === 'save-compare'))
  assert.ok(LABS.some((lab) => lab.id === 'hybrid'))
})

test('the three new labs show the field lesson in the solution', async () => {
  await withIsolatedEnv(async () => {
    const aaa = await __test.labTool.execute({ action: 'solution', lab: 'aaa-telnet' })
    assert.match(aaa.markdown, /local-user admin service-type telnet/)
    assert.match(aaa.markdown, /authentication-mode aaa/)
    assert.match(aaa.markdown, /老师傅追问/)
    const save = await __test.labTool.execute({ action: 'show', lab: 'save-compare' })
    assert.match(save.markdown, /设备要求/)
    const hybrid = await __test.labTool.execute({ action: 'solution', lab: 'hybrid' })
    assert.match(hybrid.markdown, /port hybrid untagged vlan 10 20/)
  })
})

test('fault library grew to 12 with diagnosis prompts', async () => {
  assert.equal(FAULTS.length, 12)
  for (const fault of FAULTS) {
    assert.ok(fault.ask === undefined || Array.isArray(fault.ask))
  }
  await withIsolatedEnv(async () => {
    const diagnose = await __test.faultTool.execute({ action: 'diagnose' })
    assert.match(diagnose.markdown, /先问对/)
    const compound = await __test.faultTool.execute({ action: 'show', id: 'f12-compound-nat' })
    assert.match(compound.markdown, /先问对问题/)
    assert.doesNotMatch(compound.markdown, /## 根因/)
    const answer = await __test.faultTool.execute({ action: 'answer', id: 'f12-compound-nat' })
    assert.match(answer.markdown, /复合/)
  })
})

test('curriculum phase-0 ships the eight-step device walk', async () => {
  const phase0 = CURRICULUM.find((phase) => phase.id === 'phase-0')
  assert.equal(phase0.deviceSteps.length, 8)
  assert.equal(phase0.lab, 'save-compare')
  await withIsolatedEnv(async () => {
    const page = await __test.curriculumTool.execute({ action: 'phase', phase: 'phase-0' })
    assert.match(page.markdown, /设备操作 8 步/)
    assert.match(page.markdown, /第 8 步：接口初识/)
  })
})

test('sysname checker rejects defaults and recommends field format', () => {
  assert.equal(checkSysname('Huawei').ok, false)
  assert.equal(checkSysname('').ok, false)
  assert.ok(checkSysname('SW1').notes.length > 0)
  assert.ok(checkSysname('BJ-IDC-CORE-01').recommended)
  assert.ok(checkSysname('中文名字').issues.length > 0)
})

test('config review catches field-quality problems', () => {
  const findings = reviewConfig([
    'sysname Huawei',
    'vlan batch 1 1002',
    'interface GigabitEthernet0/0/1',
    'port link-type access',
    'port default vlan 1',
    'interface GigabitEthernet0/0/24',
    'port link-type trunk',
    'port trunk allow-pass vlan all',
    'undo stp enable',
  ].join('\n'))
  const issues = findings.map((item) => item.issue).join('\n')
  assert.match(issues, /默认 sysname/)
  assert.match(issues, /保留 VLAN/)
  assert.match(issues, /trunk 放行 all/)
  assert.match(issues, /默认 VLAN 1/)
  assert.match(issues, /关闭 STP/)
  assert.ok(findings.some((item) => item.severity === 'error'))
})

test('clean config review comes back quiet', () => {
  const findings = reviewConfig([
    'sysname BJ-IDC-ACC-01',
    'vlan batch 110 120',
    'interface GigabitEthernet0/0/1',
    'description To-3F-Desk-018-Vlan110',
    'port link-type access',
    'port default vlan 110',
    'quit',
    'interface GigabitEthernet0/0/24',
    'description Uplink-To-CORE1-GE1/0/1',
    'port link-type trunk',
    'port trunk allow-pass vlan 110 120',
  ].join('\n'))
  assert.equal(findings.filter((item) => item.severity === 'error').length, 0)
})

test('standalone standard actions produce useful markdown', async () => {
  await withIsolatedEnv(async () => {
    const built = await __test.standardTool.execute({ action: 'sysname', site: 'bj', role: 'core', index: 3 })
    assert.match(built.markdown, /BJ-CORE-03/)
    const description = await __test.standardTool.execute({ action: 'description' })
    assert.match(description.markdown, /To-SW2-GE0\/0\/24/)
    const vlan = await __test.standardTool.execute({ action: 'vlan' })
    assert.match(vlan.markdown, /VLAN 1002-1005/)
    const review = await __test.standardTool.execute({ action: 'review', config: 'sysname Huawei\n' })
    assert.match(review.markdown, /错误/)
  })
})

test('checklists cover the change life cycle and bind to labs', async () => {
  assert.deepEqual(Object.keys(CHECKLISTS).sort(), ['after-change', 'before-change', 'during-change', 'troubleshoot'])
  await withIsolatedEnv(async () => {
    const before = await __test.checklistTool.execute({ action: 'show', id: 'before-change' })
    assert.match(before.markdown, /回滚/)
    assert.match(before.markdown, /display current-configuration/)
    const labCheck = await __test.checklistTool.execute({ action: 'lab', lab: 'vlan-basic' })
    assert.match(labCheck.markdown, /变更前/)
    assert.match(labCheck.markdown, /display port vlan active/)
    const list = await __test.checklistTool.execute({ action: 'list' })
    assert.match(list.markdown, /after-change/)
  })
})
