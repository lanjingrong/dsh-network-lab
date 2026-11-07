import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'

function mockSwitch() {
  return new Promise((resolve, reject) => {
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
          else if (line === 'display vlan') socket.write('\r\ndisplay vlan\r\nVLAN ID: 10\r\nVLAN ID: 20\r\n<Huawei>')
          else if (line === 'display port vlan active') {
            // Shape the output like a real VRP table so the trunk check can match.
            socket.write([
              '',
              'display port vlan active',
              'T=TAG U=UNTAG',
              '----------------------------------------------------------------',
              'Port                Link Type    PVID    VLAN List',
              '----------------------------------------------------------------',
              'GigabitEthernet0/0/1  access        10      U: 10',
              'GigabitEthernet0/0/2  access        20      U: 20',
              'GigabitEthernet0/0/24 trunk          1      U: 1 T: 10 20',
              '<Huawei>',
            ].join('\r\n'))
          } else socket.write(`\r\n${line}\r\n<Huawei>`)
        }
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

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

test('netlab_exec and netlab_verify work against a mock eNSP console', async () => {
  const { server, port } = await mockSwitch()
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-int-'))
  const previous = process.env.DSH_NETLAB_DEVICES
  process.env.DSH_NETLAB_DEVICES = path.join(dir, 'devices.json')
  try {
    fakeContext()
    await __test.devicesTool.execute({ action: 'add', id: 'sw1', name: 'SW1', port })
    const exec = await __test.execTool.execute({
      device: 'sw1',
      commands: ['display vlan'],
    })
    assert.equal(exec.ok, true)
    assert.match(exec.markdown, /VLAN ID: 10/)
    assert.match(exec.markdown, /<Huawei>/)

    const verify = await __test.verifyTool.execute({
      lab: 'vlan-basic',
      bindings: [
        { role: 'SW1', device: 'sw1' },
        { role: 'SW2', device: 'sw1' },
      ],
    })
    assert.equal(verify.ok, true)
    assert.match(verify.markdown, /通过 \*\*3\*\*/)
  } finally {
    __test.closeAllSessions()
    if (previous === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = previous
    await rm(dir, { recursive: true, force: true })
    server.close()
  }
})
