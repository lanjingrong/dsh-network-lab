import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'

/** A tiny stateful VRP mock that remembers trunk allow-pass VLANs. */
function mockSwitch() {
  return new Promise((resolve, reject) => {
    let trunkAllowed = ['10', '20']
    const server = net.createServer((socket) => {
      let buffer = ''
      socket.write('\r\n<Huawei>')
      socket.on('data', (chunk) => {
        const text = [...chunk].filter((byte) => byte === 10 || byte === 13 || byte >= 32).map((byte) => String.fromCharCode(byte)).join('')
        buffer += text
        let at
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).replace(/\r/g, '').trim()
          buffer = buffer.slice(at + 1)
          if (!line) continue
          if (line === 'screen-length 0 temporary') socket.write('\r\n<Huawei>')
          else if (line === 'undo port trunk allow-pass vlan 10') {
            trunkAllowed = trunkAllowed.filter((vlan) => vlan !== '10')
            socket.write('\r\n[Huawei-GigabitEthernet0/0/24]')
          } else if (line === 'port trunk allow-pass vlan 10') {
            if (!trunkAllowed.includes('10')) trunkAllowed.push('10')
            socket.write('\r\n[Huawei-GigabitEthernet0/0/24]')
          } else if (line === 'display port vlan active') {
            socket.write(`\r\ndisplay port vlan active\r\nGigabitEthernet0/0/24 trunk ${trunkAllowed.join(',')}\r\n<Huawei>`)
          } else {
            socket.write(`\r\n${line}\r\n<Huawei>`)
          }
        }
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

function fakeContext() {
  const ctx = {
    tools: { register: () => () => {} },
    systemPrompt: { section: () => () => {} },
    on: () => {},
  }
  apply(ctx)
}

test('fault injection and repair run against a mock device', async () => {
  const { server, port } = await mockSwitch()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-fault-'))
  const previous = process.env.DSH_NETLAB_DEVICES
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  try {
    fakeContext()
    await __test.devicesTool.execute({ action: 'add', id: 'sw1', name: 'SW1', port })
    const bindings = [{ role: 'SW1', device: 'sw1' }]

    const injected = await __test.faultTool.execute({
      action: 'answer',
      id: 'f01-vlan-mismatch',
      inject: true,
      bindings,
    })
    assert.match(injected.markdown, /已注入故障/)
    assert.match(injected.markdown, /## 根因/)

    const check = await __test.execTool.execute({ device: 'sw1', commands: ['display port vlan active'] })
    assert.match(check.markdown, /trunk 20/)

    await __test.execTool.execute({ device: 'sw1', commands: ['port trunk allow-pass vlan 10'] })
    const repaired = await __test.execTool.execute({ device: 'sw1', commands: ['display port vlan active'] })
    assert.match(repaired.markdown, /trunk [^]*10/)
    assert.match(repaired.markdown, /trunk [^]*20/)
  } finally {
    __test.closeAllSessions()
    if (previous === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = previous
    await rm(dir, { recursive: true, force: true })
    server.close()
  }
})

test('fault inject without bindings is rejected', async () => {
  fakeContext()
  await assert.rejects(
    () => __test.faultTool.execute({ action: 'answer', id: 'f01-vlan-mismatch', inject: true }),
    /bindings/,
  )
})
