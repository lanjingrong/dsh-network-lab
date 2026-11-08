import test from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { TelnetParser, createLineDecoder, repairMojibake, probeTelnet } from '../lib/telnet.js'
import { publicDevice, upsertDevice, readDevices, writeDevices, normalizeDevice } from '../lib/store.js'
import { matchPitfalls, pitfallMatchMarkdown } from '../lib/knowledge.js'

// ---------------------------------------------------------------- bug 1: GBK

const GBK_SAMPLE = Buffer.from([
  0x53, 0x35, 0x37, 0x30, 0x30, 0x2d, // S5700-
  0xd1, 0xa7, 0xcf, 0xb0, 0xbb, 0xfa, // 学习机
])

test('GBK output decodes to Chinese instead of mojibake', () => {
  const parser = new TelnetParser()
  const text = parser.push(GBK_SAMPLE).text
  assert.equal(text, 'S5700-学习机')
  assert.ok(!text.includes('\uFFFD'))
})

test('UTF-8 output still decodes correctly', () => {
  const parser = new TelnetParser()
  const bytes = Buffer.from('S5700-学习机', 'utf8')
  assert.equal(parser.push(bytes).text, 'S5700-学习机')
})

test('decoder is sticky per stream and handles split multi-byte chars', () => {
  const decoder = createLineDecoder()
  // Feed GBK bytes one at a time; every character straddles a boundary.
  let out = ''
  for (const byte of GBK_SAMPLE) {
    const result = decoder.write(Buffer.from([byte]))
    if (result.replaced) out = ''
    out += result.text
  }
  out += decoder.end().text
  assert.equal(decoder.encoding, 'gb18030')
  // The stream has no line terminator, so the decoder has nothing to replay and
  // can only guarantee the characters decoded after it settled.
  assert.ok(out.endsWith('学习机'), `got ${JSON.stringify(out)}`)
  assert.ok(!out.includes('\uFFFD'), `got ${JSON.stringify(out)}`)
})

test('a GBK line end to end decodes whole, prefix included', () => {
  const decoder = createLineDecoder()
  const line = Buffer.concat([GBK_SAMPLE, Buffer.from('\r\n')])
  let out = ''
  for (const byte of line) {
    const result = decoder.write(Buffer.from([byte]))
    if (result.replaced) out = ''
    out += result.text
  }
  out += decoder.end().text
  assert.equal(out, 'S5700-学习机\r\n')
  assert.equal(decoder.encoding, 'gb18030')
})

test('a short first chunk does not lock the stream into the wrong encoding', () => {
  const decoder = createLineDecoder()
  let out = decoder.write(Buffer.from('S5700-')).text
  const second = decoder.write(Buffer.from('学习机\r\n', 'utf8'))
  if (second.replaced) out = ''
  out += second.text
  out += decoder.end().text
  assert.equal(out, 'S5700-学习机\r\n')
  assert.equal(decoder.encoding, 'utf8')
})

test('repairMojibake fixes a name saved by an older version', () => {
  // The old decoder turned every unplaceable byte into U+FFFD. Those bytes are
  // gone, so the tail cannot be rebuilt, but the leading characters can.
  const damaged = `S5700-${String.fromCharCode(0x701B, 0xFE3F, 0x7BC4, 0x93C8, 0xFFFD)}`
  const partially = repairMojibake(damaged)
  assert.match(partially, /^S5700-/)
  assert.notEqual(partially[6], String.fromCharCode(0x701B))
  // All bytes >= 0x80 survived, so decoding through GB18030 returns exactly
  // the characters the device meant.
  const latin = `S5700-${String.fromCharCode(0x83, 0x4A, 0x83, 0x6F)}`
  assert.equal(repairMojibake(latin), `S5700-${String.fromCharCode(0x50C7, 0x50F6)}`)
  const cjk = `S5700-${String.fromCharCode(0xC6, 0xDD, 0xCF, 0xB0)}`
  assert.equal(repairMojibake(cjk), `S5700-${String.fromCharCode(0x621A, 0x4E60)}`)
})

test('publicDevice repairs legacy names on read', () => {
  // A name whose GBK bytes all survived as Latin-1 comes back readable.
  const legacy = `S5700-${String.fromCharCode(0x83, 0x4A, 0x83, 0x6F)}`
  const shown = publicDevice({ id: `sw1`, name: legacy, host: `127.0.0.1`, port: 2001 })
  assert.equal(shown.name, `S5700-${String.fromCharCode(0x50C7, 0x50F6)}`)
  // A healthy name passes through unchanged.
  const healthy = `S5700-${String.fromCharCode(0x5B66, 0x4E60, 0x673A)}`
  assert.equal(publicDevice({ id: `sw2`, name: healthy, port: 2002 }).name, healthy)
})

// ------------------------------------------------------- bug 2: atomic write

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dsh-netlab-fix-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('repeated device writes keep the file readable and never leave temp files', async () => {
  await withTempDir(async (dir) => {
    const env = { DSH_NETLAB_DEVICES: path.join(dir, 'devices.json') }
    for (let i = 0; i < 12; i += 1) {
      await upsertDevice({ id: 'sw1', name: `SW1-${i}`, port: 2000 }, env)
    }
    // The file must exist after every write, not just the last one.
    const raw = await readFile(env.DSH_NETLAB_DEVICES, 'utf8')
    const parsed = JSON.parse(raw)
    assert.equal(parsed.devices[0].name, 'SW1-11')
    const leftovers = (await readdirSafe(dir)).filter((name) => name.endsWith('.tmp'))
    assert.deepEqual(leftovers, [])
  })
})

async function readdirSafe(dir) {
  const { readdir } = await import('node:fs/promises')
  return readdir(dir)
}

test('writeDevices replaces an existing file without deleting it first', async () => {
  await withTempDir(async (dir) => {
    const file = path.join(dir, 'devices.json')
    const env = { DSH_NETLAB_DEVICES: file }
    await writeDevices([normalizeDevice({ id: 'sw1', port: 2000 })], env)
    const first = await readFile(file, 'utf8')
    await writeDevices([normalizeDevice({ id: 'sw1', port: 2001 })], env)
    const second = await readFile(file, 'utf8')
    assert.notEqual(first, second)
    assert.equal(JSON.parse(second).devices[0].port, 2001)
  })
})

// --------------------------------------------------- bug 3: symptom matching

test('natural-language symptoms now match the right pitfall', () => {
  const cases = [
    ['Trunk端口两边PVID不一样 断了', 'p09-trunk-allow'],
    ['两边的PVID不一样', 'p09-trunk-allow'],
    ['trunk 没放行 vlan', 'p09-trunk-allow'],
    ['ping不通', 'p13-no-return-route'],
    ['网段不对', 'p13-no-return-route'],
    ['OSPF 邻居起不来', 'p14-ospf-timer'],
    ['网关忘了填', 'p17-pc-gateway'],
    ['reboot 能不能解决', 'p20-reboot-first'],
  ]
  for (const [text, expected] of cases) {
    const top = matchPitfalls(text)[0]?.pitfall.id
    assert.equal(top, expected, `"${text}" 匹配到了 ${top}`)
  }
})

test('VRP error text still outranks casual phrasing', () => {
  const cases = [
    ['ECONNREFUSED 127.0.0.1:2000', 'p02-port-busy'],
    ['Unrecognized command found at "^" position 1', 'p03-view-mismatch'],
    ['Interface GigabitEthernet0/0/24 does not exist', 'p04-interface-missing'],
    ['Wrong parameter found at "^" position 9', 'p04-interface-missing'],
    ['Error: Save the configuration failed', 'p05-save-view'],
    ['---- More ----', 'p15-display-too-long'],
  ]
  for (const [text, expected] of cases) {
    assert.equal(matchPitfalls(text)[0]?.pitfall.id, expected, text)
  }
})

test('overly broad patterns no longer fire on a single word', () => {
  // Previously /网关/ and /reboot/i matched any text containing them.
  assert.deepEqual(matchPitfalls('查看网关'), [])
  assert.deepEqual(matchPitfalls('reboot'), [])
  assert.deepEqual(matchPitfalls('VLAN 10 是业务网段'), [])
})

test('symptom-only matches are labelled as heuristic in the output', () => {
  const markdown = pitfallMatchMarkdown([{ pitfall: { id: 'p13-no-return-route', title: 't', category: '三层', hint: 'h', check: [], fix: [] }, score: 1, kind: 'symptom', hits: [] }])
  assert.match(markdown, /按你描述的现象/)
  const errorMarkdown = pitfallMatchMarkdown([{ pitfall: { id: 'p02-port-busy', title: 't', category: '环境', hint: 'h', check: [], fix: [] }, score: 3, kind: 'error', hits: [] }])
  assert.match(errorMarkdown, /报错关键词/)
})
