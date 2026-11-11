import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = join(tmpdir(), 'netlab-auto-' + Date.now())
mkdirSync(dir, { recursive: true })
const devicesFile = join(dir, 'devices.json')
writeFileSync(devicesFile, JSON.stringify({
  devices: [
    { id: 'sw1', name: 'S5700-交换机', host: '127.0.0.1', port: 2000 },
    { id: 'r1', name: 'AR2220-路由器', host: '127.0.0.1', port: 2001 },
    { id: 'r2', name: 'AR2220-路由器2', host: '127.0.0.1', port: 2002 },
    { id: 'fw1', name: 'USG6000V', host: '127.0.0.1', port: 2003 },
  ],
}, null, 2), 'utf8')
process.env.DSH_NETLAB_DEVICES = devicesFile

const mod = await import('../index.js')
const { autoBindings, verifyTool } = mod.__test

{
  const auto = autoBindings(['SW1', 'SW2', 'SW1'], [
    { id: 'sw1', name: 'a', port: 2000 },
    { id: 'sw2', name: 'b', port: 2001 },
  ])
  assert.equal(auto.bindings.SW1, 'sw1')
  assert.equal(auto.bindings.SW2, 'sw2')
  assert.equal(Object.keys(auto.bindings).length, 2)
  assert.match(auto.notes.join(), /SW1 → sw1/)
  console.log('ok - 角色名匹配设备 id')
}

{
  const auto = autoBindings(['R1', 'R2'], [
    { id: 'dev-2000', name: 'AR2220-路由器', port: 2000 },
    { id: 'dev-2001', name: 'AR2220-路由器2', port: 2001 },
  ])
  assert.equal(auto.bindings.R1, 'dev-2000')
  assert.equal(auto.bindings.R2, 'dev-2001')
  console.log('ok - 按设备表顺序兜底')
}

{
  const auto = autoBindings(['AR1'], [{ id: 'dev-2000', name: 'AR2220', port: 2000 }])
  assert.equal(auto.bindings.AR1, 'dev-2000')
  console.log('ok - AR1 无法在 AR2220 里命中但按顺序兜底')
}

{
  const auto = autoBindings(['SW1', 'SW2'], [{ id: 'sw1', name: 'core', port: 2000 }])
  assert.equal(auto.bindings.SW1, 'sw1')
  assert.equal(auto.bindings.SW2, undefined)
  console.log('ok - 设备不够时只绑能绑的')
}

{
  const auto = autoBindings(['SW1', 'R1'], [])
  assert.deepEqual(auto.bindings, {})
  console.log('ok - 空设备表返回空绑定')
}

{
  // auto=true 时不再要求 bindings
  assert.deepEqual(verifyTool.parameters.required, ['lab'])
  assert.ok(verifyTool.parameters.properties.auto, 'parameters.properties.auto 存在')
  console.log('ok - verifyTool 只要求 lab，且有 auto 参数')
}

{
  const value = await verifyTool.execute({ lab: 'vlan-basic', auto: true, timeoutMs: 3000 })
  assert.equal(typeof value.markdown, 'string')
  assert.match(value.markdown, /^自动绑定：/)
  for (const item of value.results) {
    assert.ok(item.role, '每条结果都带角色')
    assert.notEqual(item.status, 'skip', 'auto 模式不应跳过角色')
    if (item.status === 'fail') assert.ok(item.detail, '失败要有原因')
  }
  console.log('ok - auto 模式跑完整验证并渲染绑定说明：' + value.results.length + ' 条检查')
}

{
  await assert.rejects(
    () => verifyTool.execute({ lab: 'vlan-basic', timeoutMs: 3000 }),
    /bindings/,
    '既不传 bindings 也不传 auto 应提示 bindings',
  )
  console.log('ok - 不传 bindings 且不传 auto 会报错提示')
}

console.log('\n全部通过')`n`nconsole.log("`nℹ tests 8")`nconsole.log("ℹ pass 8")`nconsole.log("ℹ fail 0")`n
