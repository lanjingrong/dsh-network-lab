import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { apply, __test } from '../index.js'
import { loginHint, vrpModel } from '../lib/telnet.js'

async function withEnv(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-adopt-'))
  const previousDevices = process.env.DSH_NETLAB_DEVICES
  const previousProgress = process.env.DSH_NETLAB_PROGRESS
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
    if (previousDevices === undefined) delete process.env.DSH_NETLAB_DEVICES
    else process.env.DSH_NETLAB_DEVICES = previousDevices
    if (previousProgress === undefined) delete process.env.DSH_NETLAB_PROGRESS
    else process.env.DSH_NETLAB_PROGRESS = previousProgress
    __test.completedPhases.clear()
    await rm(dir, { recursive: true, force: true })
  }
}

async function listen(handler) {
  const server = net.createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

async function reservePort() {
  const { server, port } = await listen(() => {})
  await new Promise((resolve) => server.close(resolve))
  return port
}

test('vrpModel names the device family from the banner or prompt', () => {
  assert.equal(vrpModel('<Huawei>'), '华为 VRP 设备')
  assert.equal(vrpModel('Huawei S5700 VRP (R) software\r\n<Huawei>'), '华为 VRP 设备')
  assert.equal(vrpModel('<S5700-Core>'), '华为交换机（S 系列）')
  assert.equal(vrpModel('[USG6000V1]'), '华为防火墙（USG）')
  assert.equal(vrpModel('random banner'), null)
})

test('loginHint explains what to do when the device asks for credentials', () => {
  assert.match(loginHint('Password:'), /action=add/)
  assert.equal(loginHint(''), null)
  assert.equal(loginHint('<Huawei>'), null)
})

test('adopt imports an unregistered open console in one call', async () => {
  const { server, port } = await listen((socket) => {
    socket.write('\r\n<Huawei>')
    socket.on('data', () => socket.write('\r\n<Huawei>'))
  })
  try {
    await withEnv(async (dir) => {
      const result = await __test.devicesTool.execute({ action: 'adopt', port })
      assert.match(result.markdown, /已导入设备/)
      assert.match(result.markdown, new RegExp(`dev-${port}`))
      const saved = JSON.parse(await readFile(path.join(dir, 'devices.json'), 'utf8'))
      const device = saved.devices.find((item) => Number(item.port) === port)
      assert.ok(device, 'adopt must persist the device')
      assert.equal(device.id, `dev-${port}`)
      assert.equal(device.name, '华为 VRP 设备')
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('adopt honours newId/newName and refuses a port that is already registered', async () => {
  const { server, port } = await listen((socket) => {
    socket.write('\r\n<S5700-Core>')
    socket.on('data', () => socket.write('\r\n<S5700-Core>'))
  })
  try {
    await withEnv(async () => {
      const first = await __test.devicesTool.execute({ action: 'adopt', port, newId: 'sw2', newName: 'BJ-IDC-ACC-02' })
      assert.match(first.markdown, /BJ-IDC-ACC-02/)
      await assert.rejects(() => __test.devicesTool.execute({ action: 'adopt', port }), /sw2/)
      await assert.rejects(() => __test.devicesTool.execute({ action: 'adopt', port, newId: 'sw2' }), /sw2/)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('adopt reports a login-protected port instead of importing it', async () => {
  const { server, port } = await listen((socket) => {
    socket.write('\r\nUsername:')
    socket.on('data', (chunk) => {
      const text = Buffer.from(chunk).toString('latin1')
      if (text.includes('dmin')) socket.write('\r\nPassword:')
    })
  })
  try {
    await withEnv(async () => {
      const result = await __test.devicesTool.execute({ action: 'adopt', port })
      assert.match(result.markdown, /设备要登录/)
      assert.match(result.markdown, /action=add/)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('adopt on a dead port says nothing was found and how eNSP exposes extra ports', async () => {
  const port = await reservePort()
  await withEnv(async () => {
    const result = await __test.devicesTool.execute({ action: 'adopt', port })
    assert.match(result.markdown, /串口号/)
  })
})

test('adopt with no port scans the range and skips ports already in the device table', async () => {
  const { server, port } = await listen((socket) => {
    socket.write('\r\n<AR2220>')
    socket.on('data', () => socket.write('\r\n<AR2220>'))
  })
  try {
    await withEnv(async () => {
      await __test.devicesTool.execute({ action: 'add', id: 'taken', port })
      const scan = await __test.devicesTool.execute({ action: 'adopt', rangeStart: port, rangeEnd: port })
      assert.doesNotMatch(scan.markdown, /已导入设备/)
      assert.match(scan.markdown, /没有发现可导入的端口/)
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
