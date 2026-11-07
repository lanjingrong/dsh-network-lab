import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import { TelnetParser, cleanOutput, hasPrompt, TelnetSession, probeTelnet } from '../lib/telnet.js'

const IAC = 255
const WILL = 251
const DONT = 254

test('TelnetParser refuses options and strips negotiations', () => {
  const parser = new TelnetParser()
  const result = parser.push(Buffer.from([IAC, WILL, 1, ...Buffer.from('hello')]))
  assert.equal(result.text, 'hello')
  assert.deepEqual([...result.replies], [IAC, DONT, 1])
})

test('hasPrompt recognizes user and system views', () => {
  assert.equal(hasPrompt('\r\n<Huawei>'), true)
  assert.equal(hasPrompt('[Huawei-GigabitEthernet0/0/1]'), true)
  assert.equal(hasPrompt('Error: wrong parameter\n<Huawei>'), true)
  assert.equal(hasPrompt('VLAN ID: 10'), false)
})

test('cleanOutput removes echo, prompt and paging marker', () => {
  const raw = '\r\n<Huawei>display vlan\r\nVLAN ID: 10\r\n---- More ----\r\n<Huawei>'
  assert.equal(cleanOutput(raw, 'display vlan'), 'VLAN ID: 10')
})

function createMock({ login = false } = {}) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      let buffer = ''
      let stage = login ? 'username' : 'ready'
      socket.write(login ? '\r\nUsername:' : '\r\n<Huawei>')

      socket.on('data', (chunk) => {
        // Ignore client Telnet negotiation replies and keep printable lines.
        const text = [...chunk].filter((byte) => byte === 10 || byte === 13 || byte >= 32).map((byte) => String.fromCharCode(byte)).join('')
        buffer += text
        let at
        while ((at = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, at).replace(/\r/g, '').trim()
          buffer = buffer.slice(at + 1)
          if (!line) continue

          if (stage === 'username') {
            assert.equal(line, 'admin')
            stage = 'password'
            socket.write('\r\nPassword:')
            continue
          }
          if (stage === 'password') {
            assert.equal(line, 'secret')
            stage = 'ready'
            socket.write('\r\n<Huawei>')
            continue
          }

          if (line === 'screen-length 0 temporary') {
            socket.write('\r\n<Huawei>')
          } else if (line === 'display vlan') {
            socket.write('\r\ndisplay vlan\r\nVLAN ID: 10\r\nVLAN ID: 20\r\n<Huawei>')
          } else if (line === 'save') {
            socket.write('\r\nThe current configuration will be written to the device.\r\nAre you sure to continue?[Y/N]')
          } else if (line === 'y') {
            socket.write('\r\nSave the configuration successfully.\r\n<Huawei>')
          } else {
            socket.write(`\r\n${line}\r\nError: Unrecognized command\r\n<Huawei>`)
          }
        }
      })
    })
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

test('TelnetSession connects, executes commands and saves', async () => {
  const { server, port } = await createMock()
  const session = new TelnetSession({ host: '127.0.0.1', port, commandTimeoutMs: 4000 })
  try {
    await session.connect()
    const [vlan] = await session.exec(['display vlan'])
    assert.match(vlan.output, /VLAN ID: 10/)
    assert.equal(vlan.ok, true)
    const saved = await session.save()
    assert.match(saved.output, /successfully/)
    assert.equal(saved.ok, true)
  } finally {
    session.close()
    server.close()
  }
})

test('TelnetSession logs in with username and password', async () => {
  const { server, port } = await createMock({ login: true })
  const session = new TelnetSession({
    host: '127.0.0.1',
    port,
    username: 'admin',
    password: 'secret',
    commandTimeoutMs: 4000,
  })
  try {
    await session.connect()
    const [result] = await session.exec(['display vlan'])
    assert.match(result.output, /VLAN ID: 20/)
  } finally {
    session.close()
    server.close()
  }
})

test('probeTelnet reports an open eNSP-like console', async () => {
  const { server, port } = await createMock()
  try {
    const result = await probeTelnet('127.0.0.1', port, 1000)
    assert.equal(result.open, true)
    assert.match(result.prompt, /Huawei/)
  } finally {
    server.close()
  }
})
