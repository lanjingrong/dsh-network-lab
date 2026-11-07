import net from 'node:net'
import { StringDecoder } from 'node:string_decoder'

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Minimal RFC 854 parser. It strips Telnet commands from the byte stream and
 * refuses every option, which is enough for Huawei VRP console sessions.
 */
export class TelnetParser {
  constructor() {
    this.state = 'data'
    this.pendingVerb = 0
    this.decoder = new StringDecoder('utf8')
  }

  push(chunk) {
    const out = []
    const replies = []
    for (const byte of chunk) {
      if (this.state === 'data') {
        if (byte === IAC) this.state = 'iac'
        else out.push(byte)
        continue
      }
      if (this.state === 'iac') {
        if (byte === IAC) {
          out.push(IAC)
          this.state = 'data'
        } else if (byte === WILL || byte === WONT || byte === DO || byte === DONT) {
          this.pendingVerb = byte
          this.state = 'option'
        } else if (byte === SB) {
          this.state = 'sb'
        } else {
          this.state = 'data'
        }
        continue
      }
      if (this.state === 'option') {
        if (this.pendingVerb === WILL) replies.push(IAC, DONT, byte)
        else if (this.pendingVerb === DO) replies.push(IAC, WONT, byte)
        this.state = 'data'
        continue
      }
      if (this.state === 'sb') {
        if (byte === IAC) this.state = 'sbIac'
        continue
      }
      if (this.state === 'sbIac') {
        this.state = byte === SE ? 'data' : 'sb'
      }
    }
    return {
      text: this.decoder.write(Buffer.from(out)),
      replies: Buffer.from(replies),
    }
  }

  end() {
    return this.decoder.end()
  }
}

/** True when the buffer ends in a Huawei user-view `<HOST>` or system-view `[HOST]` prompt. */
export function hasPrompt(text) {
  const tail = String(text || '')
    .replace(/\r/g, '')
    .replace(/[ \t]+$/gm, '')
    .trimEnd()
  if (!tail) return false
  const lastLine = tail.slice(tail.lastIndexOf('\n') + 1)
  return /^(?:<[^<>\n]{1,80}>|\[~?[^\[\]\n]{1,120}\])$/.test(lastLine)
}

/** Return the final prompt, or an empty string. */
export function extractPrompt(text) {
  const clean = String(text || '').replace(/\r/g, '').trimEnd()
  const lastLine = clean.slice(clean.lastIndexOf('\n') + 1)
  return /^(?:<[^<>\n]{1,80}>|\[~?[^\[\]\n]{1,120}\])$/.test(lastLine) ? lastLine : ''
}

/**
 * Remove terminal noise, echoed command text, paging markers and the trailing
 * prompt from a captured command response.
 */
export function cleanOutput(text, command = '') {
  let value = String(text || '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\r/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')

  // Apply backspaces the way a terminal would.
  let resolved = ''
  for (const char of value) {
    if (char === '\b') resolved = resolved.slice(0, -1)
    else resolved += char
  }
  value = resolved

  const lines = value.split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()

  const wanted = String(command || '').trim()
  if (wanted && lines.length) {
    const first = lines[0]
    const at = first.indexOf(wanted)
    if (at >= 0) {
      const rest = first.slice(at + wanted.length).trim()
      // A trailing newline right after the echoed command leaves a blank first
      // line; drop it so the output starts with real device response.
      const next = rest ? lines.slice(1) : lines.slice(1)
      while (next.length && next[0].trim() === '') next.shift()
      if (rest) next.unshift(rest)
      lines.length = 0
      lines.push(...next)
    }
  }

  if (lines.length && hasPrompt(lines[lines.length - 1].trim())) lines.pop()

  return lines
    .filter((line) => !/^-{2,}\s*More\s*-{2,}$/i.test(line.trim()))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** True when a VRP response looks like a rejected command. */
export function looksLikeError(output) {
  const text = String(output || '')
  return /(^|\n)\s*(Error:|Wrong parameter|Unrecognized command|Incomplete command|Ambiguous command|Too many parameters|The command is not found)/i.test(text)
    || /\n\s*\^\s*\n/.test(text)
}

export class TelnetSession {
  constructor(options = {}) {
    this.options = {
      host: options.host || '127.0.0.1',
      port: Number(options.port || 2000),
      username: options.username || '',
      password: options.password || '',
      connectTimeoutMs: Number(options.connectTimeoutMs || 8000),
      commandTimeoutMs: Number(options.commandTimeoutMs || 12000),
      label: options.label || `${options.host || '127.0.0.1'}:${options.port || 2000}`,
    }
    this.socket = undefined
    this.parser = new TelnetParser()
    this.text = ''
    this.closed = true
    this.lastPrompt = ''
    this.lastError = ''
  }

  get connected() {
    return !this.closed && this.socket !== undefined
  }

  async connect() {
    if (this.connected) return this
    this.closed = false
    this.text = ''
    this.lastError = ''

    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.options.host, port: this.options.port })
      this.socket = socket
      socket.setNoDelay(true)
      const timer = setTimeout(() => {
        this.lastError = `连接 ${this.options.host}:${this.options.port} 超时`
        socket.destroy()
        reject(new Error(this.lastError))
      }, this.options.connectTimeoutMs)

      socket.once('connect', () => {
        clearTimeout(timer)
        socket.setNoDelay(true)
        resolve()
      })
      socket.on('data', (chunk) => {
        const parsed = this.parser.push(chunk)
        if (parsed.replies.length) socket.write(parsed.replies)
        if (parsed.text) {
          this.text += parsed.text
          if (this.text.length > 512 * 1024) this.text = this.text.slice(-256 * 1024)
        }
      })
      socket.on('error', (error) => {
        this.lastError = error instanceof Error ? error.message : String(error)
        this.closed = true
        clearTimeout(timer)
        reject(error)
      })
      socket.on('close', () => {
        this.closed = true
      })
    })

    await this.#login()
    try {
      await this.#run('screen-length 0 temporary', { timeoutMs: 3500, quiet: true })
    } catch {
      // Some VRP builds do not expose screen-length in user view; paging is
      // handled by the More loop below.
    }
    return this
  }

  async #login() {
    await sleep(250)
    this.writeRaw('\r\n')
    let sentUsername = false
    let sentPassword = false
    const deadline = Date.now() + Math.max(8000, this.options.commandTimeoutMs)

    while (Date.now() < deadline) {
      const tail = this.text.slice(-6000)
      if (hasPrompt(tail)) {
        this.lastPrompt = extractPrompt(tail)
        return
      }
      if (/Username\s*:\s*$/i.test(tail) && !sentUsername) {
        sentUsername = true
        if (!this.options.username) {
          throw new Error('设备要求用户名，但配置中没有 username')
        }
        this.writeLine(this.options.username)
        await sleep(450)
        continue
      }
      if (/Password\s*:\s*$/i.test(tail) && !sentPassword) {
        sentPassword = true
        if (!this.options.password) {
          throw new Error('设备要求密码，但配置中没有 password')
        }
        this.writeLine(this.options.password)
        await sleep(650)
        continue
      }
      if (/(?:login|User name)\s*:\s*$/i.test(tail) && !sentUsername) {
        sentUsername = true
        this.writeLine(this.options.username || '')
        await sleep(450)
        continue
      }
      if (/\[Y\/N\]\s*$/i.test(tail)) {
        this.writeLine('y')
        await sleep(400)
        continue
      }
      if (/Press any key/i.test(tail)) {
        this.writeRaw('\r\n')
        await sleep(400)
        continue
      }
      if (/change the password|initial password|password has expired/i.test(tail)) {
        throw new Error('设备要求修改初始密码，请先在 eNSP 控制台完成密码设置')
      }
      await sleep(150)
    }
    throw new Error(`登录超时：未识别到 VRP 提示符。最近输出：${cleanOutput(this.text).slice(-600) || '(空)'}`)
  }

  async #waitSince(start, matcher, timeoutMs) {
    const deadline = Date.now() + timeoutMs
    while (true) {
      const segment = this.text.slice(start)
      if (matcher(segment)) return segment
      if (this.closed) {
        throw new Error(`连接已关闭${this.lastError ? `：${this.lastError}` : ''}`)
      }
      if (Date.now() > deadline) {
        throw new Error(`等待设备输出超时（${timeoutMs}ms）。最近输出：${cleanOutput(segment).slice(-700) || '(空)'}`)
      }
      await sleep(40)
    }
  }

  async #run(command, options = {}) {
    const timeoutMs = Number(options.timeoutMs || this.options.commandTimeoutMs)
    const start = this.text.length
    this.writeLine(command)
    const deadline = Date.now() + timeoutMs

    while (true) {
      const segment = await this.#waitSince(
        start,
        (text) => {
          const tail = text.slice(-8000)
          return hasPrompt(tail) || /-{2,}\s*More\s*-{2,}/i.test(tail) || /\[Y\/N\]\s*$/i.test(tail)
        },
        Math.max(500, deadline - Date.now()),
      )

      if (/-{2,}\s*More\s*-{2,}/i.test(segment.slice(-200))) {
        this.writeRaw(' ')
        await sleep(90)
        continue
      }

      if (/\[Y\/N\]\s*$/i.test(segment)) {
        this.writeLine('y')
        await sleep(120)
        continue
      }

      this.lastPrompt = extractPrompt(this.text.slice(-6000))
      return {
        command,
        output: options.quiet ? '' : cleanOutput(segment, command),
        prompt: this.lastPrompt,
        raw: segment,
      }
    }
  }

  async exec(commands, options = {}) {
    if (!this.connected) throw new Error('Telnet 会话未连接')
    const results = []
    for (const command of commands) {
      const result = await this.#run(command, options)
      results.push({
        command,
        output: result.output,
        ok: !looksLikeError(result.output),
        prompt: result.prompt,
      })
    }
    return results
  }

  async save() {
    if (!this.connected) throw new Error('Telnet 会话未连接')
    const start = this.text.length
    this.writeLine('save')
    const deadline = Date.now() + Math.max(this.options.commandTimeoutMs, 15000)

    while (Date.now() < deadline) {
      const segment = this.text.slice(start)
      if (/\[Y\/N\]\s*$/i.test(segment)) {
        this.writeLine('y')
        await sleep(200)
        continue
      }
      if (hasPrompt(segment)) {
        this.lastPrompt = extractPrompt(segment)
        return {
          ok: !looksLikeError(cleanOutput(segment, 'save')),
          output: cleanOutput(segment, 'save'),
          prompt: this.lastPrompt,
        }
      }
      if (this.closed) throw new Error('保存配置时连接关闭')
      await sleep(60)
    }
    throw new Error('保存配置等待确认超时')
  }

  /**
   * Send reboot and answer the "Continue? [Y/N]" prompt. Returns the last
   * output before the device drops the TCP session (reboot closes the console).
   */
  async reboot({ timeoutMs } = {}) {
    if (!this.connected) throw new Error('Telnet 会话未连接')
    const start = this.text.length
    this.writeLine('reboot')
    const deadline = Date.now() + Math.max(Number(timeoutMs) || 30000, 10000)
    let answered = false
    while (Date.now() < deadline) {
      const segment = this.text.slice(start)
      if (/\[Y\/N\]\s*$/i.test(segment) && !answered) {
        answered = true
        this.writeLine('y')
        await sleep(200)
        continue
      }
      if (this.closed) {
        return {
          ok: !looksLikeError(cleanOutput(segment, 'reboot')),
          output: cleanOutput(segment, 'reboot'),
          disconnected: true,
        }
      }
      // The device answered with an error and is back at a prompt: it refused.
      if (!answered && hasPrompt(segment) && looksLikeError(cleanOutput(segment, 'reboot'))) {
        return {
          ok: false,
          output: cleanOutput(segment, 'reboot'),
          disconnected: false,
          refused: true,
        }
      }
      await sleep(80)
    }
    // No prompt and still connected: the device may have silently started rebooting.
    const segment = this.text.slice(start)
    return {
      ok: !looksLikeError(cleanOutput(segment, 'reboot')),
      output: cleanOutput(segment, 'reboot'),
      disconnected: this.closed,
    }
  }

  writeLine(line) {
    this.writeRaw(`${String(line).replace(/[\r\n]+/g, ' ')}\r\n`)
  }

  writeRaw(value) {
    if (!this.connected) throw new Error('Telnet 会话未连接')
    this.socket.write(value)
  }

  close() {
    this.closed = true
    try {
      this.socket?.end()
      this.socket?.destroy()
    } catch {
      // ignore close errors
    }
    this.socket = undefined
  }
}

/**
 * Probe one TCP port without keeping it open. Useful for discovering eNSP
 * console ports (the first device is normally 127.0.0.1:2000).
 */
export function probeTelnet(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    let text = ''
    let settled = false
    let timer
    const parser = new TelnetParser()
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.destroy() } catch { /* ignore */ }
      resolve(result)
    }
    timer = setTimeout(() => finish({ open: false, host, port, error: 'timeout' }), timeoutMs)

    socket.setNoDelay(true)
    socket.once('connect', () => {
      socket.write('\r\n')
      setTimeout(() => {
        finish({
          open: true,
          host,
          port,
          banner: cleanOutput(text).slice(0, 240),
          prompt: extractPrompt(text),
        })
      }, Math.min(450, Math.max(200, timeoutMs - 200)))
    })
    socket.on('data', (chunk) => {
      const parsed = parser.push(chunk)
      if (parsed.replies.length) socket.write(parsed.replies)
      text += parsed.text
      if (text.length > 4096) text = text.slice(-4096)
    })
    socket.once('error', (error) => {
      finish({ open: false, host, port, error: error instanceof Error ? error.message : String(error) })
    })
  })
}
