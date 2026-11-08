import path from 'node:path'
import os from 'node:os'
import { chmod, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { repairMojibake } from './telnet.js'

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/

/**
 * Replace `file` with already-written `temp` without ever leaving `file`
 * missing. POSIX rename overwrites atomically. Windows refuses an existing
 * target, so the first attempt fails with EPERM/EEXIST/EACCES and we fall back
 * to the old remove-then-rename — but only after proving the target is still
 * there, so the destructive path is never taken on a healthy file.
 */
async function replaceFile(temp, file) {
  try {
    await rename(temp, file)
    return
  } catch (error) {
    const code = error && error.code
    if (code !== 'EACCES' && code !== 'EPERM' && code !== 'EEXIST') throw error
  }
  // Windows cannot rename over an existing file. Confirm the target is still
  // present before deleting so a stray ENOENT never turns into a lost file.
  try {
    await readFile(file)
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await rename(temp, file)
      return
    }
    throw error
  }
  await unlink(file)
  await rename(temp, file)
}

export function resolveStorePath(env = process.env) {
  if (env.DSH_NETLAB_DEVICES) return path.resolve(env.DSH_NETLAB_DEVICES)
  const candidates = []
  if (env.DSH_HOME) candidates.push(path.join(env.DSH_HOME, 'network-lab', 'devices.json'))
  candidates.push(path.join(process.cwd(), '.dsh', 'network-lab', 'devices.json'))
  candidates.push(path.join(os.homedir(), '.dsh', 'network-lab', 'devices.json'))
  return candidates[0]
}

/** Progress is stored next to the device file, but can be redirected independently. */
export function resolveProgressPath(env = process.env) {
  if (env.DSH_NETLAB_PROGRESS) return path.resolve(env.DSH_NETLAB_PROGRESS)
  return path.join(path.dirname(resolveStorePath(env)), 'progress.json')
}

export function emptyProgress() {
  return { version: 1, completed: [], notes: {}, updatedAt: null }
}

function normalizeProgress(raw) {
  const base = emptyProgress()
  if (!raw || typeof raw !== 'object') return base
  const completed = Array.isArray(raw.completed)
    ? [...new Set(raw.completed.filter((id) => typeof id === 'string' && id.trim()))]
    : []
  const notes = raw.notes && typeof raw.notes === 'object' && !Array.isArray(raw.notes) ? raw.notes : {}
  const cleanNotes = {}
  for (const [key, value] of Object.entries(notes)) {
    if (typeof value === 'string' && value.trim()) cleanNotes[key] = value.slice(0, 500)
  }
  return {
    version: 1,
    completed,
    notes: cleanNotes,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
  }
}

export async function readProgress(env = process.env) {
  const file = resolveProgressPath(env)
  try {
    const raw = await readFile(file, 'utf8')
    return normalizeProgress(JSON.parse(raw.replace(/^\uFEFF/, '')))
  } catch (error) {
    if (error && error.code === 'ENOENT') return emptyProgress()
    if (error instanceof SyntaxError) throw new Error(`进度文件 JSON 解析失败：${file}`)
    throw error
  }
}

/**
 * In-process write queue. The atomic replace (rm + rename) briefly leaves the
 * target missing, so a concurrent read can observe ENOENT or a half-written
 * file. Serialising read-merge-write per process removes that window for the
 * common case of several tool calls landing in the same turn.
 */
let progressQueue = Promise.resolve()

function enqueueProgress(task) {
  const run = progressQueue.then(task, task)
  progressQueue = run.catch(() => {})
  return run
}

export async function writeProgress(patch, env = process.env) {
  return enqueueProgress(async () => {
    const file = resolveProgressPath(env)
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    let merged
    for (let attempt = 0; attempt < 5; attempt += 1) {
      // Always merge onto the file on disk so a plugin load in flight (or a
      // second DSH process) cannot overwrite completions written moments ago.
      let current = emptyProgress()
      try {
        current = await readProgress(env)
      } catch {
        // A racing writer can leave a transient read error; retry rather than
        // clobber the file with an empty document.
        await new Promise((resolve) => setTimeout(resolve, 5))
        continue
      }
      merged = normalizeProgress({ ...current, ...(patch || {}) })
      if (patch && patch.notes) {
        merged.notes = normalizeProgress({ notes: { ...current.notes, ...patch.notes } }).notes
      }
      merged.updatedAt = new Date().toISOString()
      await writeFile(temp, `${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      await replaceFile(temp, file)
      return merged
    }
    return merged || emptyProgress()
  })
}

/** Read progress, waiting for any queued write so callers never see a half state. */
export async function readProgressQueued(env = process.env) {
  return enqueueProgress(() => readProgress(env))
}

export function normalizeDevice(input = {}) {
  const id = String(input.id || '').trim()
  if (!ID_RE.test(id)) {
    throw new Error('设备 id 必须是 1-32 位字母、数字、下划线或连字符，例如 sw1 / r1-core')
  }
  const host = String(input.host || '127.0.0.1').trim()
  if (!host || /[\s/]/.test(host)) throw new Error(`设备 ${id} 的 host 不合法`)
  const port = Number(input.port ?? 2000)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`设备 ${id} 的端口必须是 1-65535 的整数`)
  }
  const protocol = String(input.protocol || 'telnet').toLowerCase()
  if (protocol !== 'telnet') {
    throw new Error(`设备 ${id} 的 protocol 目前只支持 telnet；eNSP 的 Console/Telnet 端口就是 telnet`)
  }
  const username = String(input.username || '').slice(0, 128)
  const password = String(input.password || '').slice(0, 256)
  return {
    id,
    name: String(input.name || id).slice(0, 80),
    host,
    port,
    protocol,
    username,
    password,
    notes: String(input.notes || '').slice(0, 500),
    updatedAt: new Date().toISOString(),
  }
}

export function publicDevice(device) {
  return {
    id: device.id,
    // Older versions decoded GBK output as UTF-8; repair names already saved.
    name: repairMojibake(device.name),
    host: device.host,
    port: device.port,
    protocol: device.protocol,
    username: device.username,
    hasPassword: Boolean(device.password),
    notes: repairMojibake(device.notes),
    updatedAt: device.updatedAt,
  }
}

export async function readDevices(env = process.env) {
  const file = resolveStorePath(env)
  try {
    const raw = await readFile(file, 'utf8')
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : parsed?.devices
    if (!Array.isArray(list)) return []
    return list.map((item) => normalizeDevice({ ...item, name: repairMojibake(item.name), notes: repairMojibake(item.notes) }))
  } catch (error) {
    if (error && error.code === 'ENOENT') return []
    if (error instanceof SyntaxError) throw new Error(`设备文件 JSON 解析失败：${file}`)
    throw error
  }
}

export async function writeDevices(devices, env = process.env) {
  const file = resolveStorePath(env)
  const dir = path.dirname(file)
  await mkdir(dir, { recursive: true })
  const body = `${JSON.stringify({ version: 1, devices }, null, 2)}\n`
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, body, 'utf8')
  await replaceFile(temp, file)
  try { await chmod(file, 0o600) } catch { /* Windows 或不支持 chmod 的文件系统 */ }
  return file
}

export async function upsertDevice(input, env = process.env) {
  const devices = await readDevices(env)
  const incoming = normalizeDevice(input)
  const index = devices.findIndex((item) => item.id === incoming.id)
  if (index >= 0) {
    // An omitted password means "keep the saved one"; an explicit empty string clears it.
    if (input.password === undefined) incoming.password = devices[index].password
    devices[index] = incoming
  } else {
    devices.push(incoming)
  }
  await writeDevices(devices, env)
  return { device: publicDevice(incoming), replaced: index >= 0 }
}

export async function removeDevice(id, env = process.env) {
  const devices = await readDevices(env)
  const next = devices.filter((item) => item.id !== id)
  if (next.length === devices.length) return false
  await writeDevices(next, env)
  return true
}

/** Resolve a saved id, a display name, or a host:port pair. */
export function findDevice(devices, ref) {
  const value = String(ref || '').trim()
  if (!value) throw new Error('缺少 device：请传设备 id，或 host:port')
  const direct = devices.find((item) => item.id === value)
  if (direct) return direct
  const byName = devices.find((item) => item.name === value)
  if (byName) return byName
  const match = /^([^\s:]+):(\d{1,5})$/.exec(value)
  if (match) {
    return normalizeDevice({
      id: `adhoc-${match[1].replace(/[^A-Za-z0-9]/g, '-')}-${match[2]}`.slice(0, 32),
      name: value,
      host: match[1],
      port: Number(match[2]),
      protocol: 'telnet',
    })
  }
  throw new Error(`找不到设备 "${value}"。先运行 netlab_devices action=scan，或 action=add 添加。`)
}
