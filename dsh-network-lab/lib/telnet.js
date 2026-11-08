import net from 'node:net'

const IAC = 255
const DONT = 254
const DO = 253
const WONT = 252
const WILL = 251
const SB = 250
const SE = 240

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Huawei VRP over a console does not always speak UTF-8: eNSP running on a
 * Chinese Windows emits GBK for every Chinese character (interface
 * descriptions, banner text, sysname). Decoding GBK as UTF-8 turns
 * "学习机" into "瀛︿範鏈�", and that garbage is what ended up in devices.json.
 *
 * Strategy: accumulate raw bytes, keep the last few bytes back because a
 * multi-byte character can straddle two TCP segments, then decode the stable
 * prefix. UTF-8 is tried first; if the prefix contains an invalid byte
 * sequence (only possible in GBK) we switch the whole stream to GB18030.
 * The mode is sticky, so one Chinese byte cannot flip decoding back and forth.
 */
const GB18030_MARKER = '\uFFFD'
const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const utf8Lenient = new TextDecoder('utf-8')
const gb18030 = new TextDecoder('gb18030')

// A run of CJK (and full-width punctuation) followed by printable ASCII.
const UTF8_CJK_RUN = new RegExp('^[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+(?:[ \t!-~]*)$')

/**
 * Decide between UTF-8 and GB18030 from a sample of raw bytes.
 *
 * "Is this valid UTF-8?" is not a reliable test: GBK's two-byte characters are
 * in 0x81-0xFE / 0x40-0xFE, so a short GBK sample can accidentally form valid
 * UTF-8 byes ("学习机" -> D1 A7 CF B0 BB FA decodes as "\u07A7\u03F0\u07EA"... no,
 * as "ѧ" plus garbage). Grade the candidate decodings instead: mojibake is what
 * UTF-8 makes of GBK and vice versa, and the real text always has far more
 * letters / CJK / digits than replacement chars or symbols in odd ranges.
 */
export function scoreText(text, encoding) {
  let good = 0
  let bad = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (code === 0xfffd) bad += 3
    else if (code < 0x20 && code !== 9 && code !== 10 && code !== 13) bad += 2
    // GBK garbled into UTF-8 lands on the Cyrillic, Greek and box-drawing
    // blocks (ѧ, ︿, 鏈 …); a real Chinese console shows CJK, kana and ASCII.
    else if ((code >= 0x400 && code <= 0x52f) || (code >= 0x370 && code <= 0x3ff) || (code >= 0x2500 && code <= 0x25ff)) bad += 2
    // The private-use area: UTF-16 residues of a mis-paired GBK pair, never
    // console text.
    else if (code >= 0xe000 && code <= 0xf8ff) bad += 2
    else if (code >= 0x4e00 && code <= 0x9fff) good += 1
    // Kana never appear in VRP output; in UTF-8 a GBK pair can land there.
    else if (code >= 0x3040 && code <= 0x30ff) good += encoding === 'gb18030' ? 0.6 : 1
    else if ((code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) good += 1
    else if (code >= 0x20) good += 0.1
  }
  return good - bad
}

function decodeStrict(text) {
  try {
    return utf8Strict.decode(text)
  } catch {
    return null
  }
}

/**
 * Decide how the rest of a stream must be decoded, given what has been seen in
 * pending mode. The first high byte matters most: in GBK a multi-byte character
 * starts with 0x81-0xFE, so 0x80 alone can only be GBK, and a trail byte such as
 * 0xBB says little on its own. Only 0xC2-0xF4 can open a UTF-8 character, so a
 * stream whose first high byte is elsewhere is GBK straight away.
 *
 * When the first high byte could belong to either encoding the sample is graded
 * (a GBK pair decodes as only one or two strange UTF-8 characters), and a
 * sample holding a single Chinese character is still graded rather than
 * guessed: one character is enough when it is unambiguous.
 *
 * Returns 'utf8', 'gb18030' or 'wait' (not enough evidence yet; end() decides).
 */
export function decideStream(pending, firstHigh) {
  // A GBK character opens with 0x81-0xFE, a UTF-8 one with 0xC2-0xF4. Outside
  // that overlap only GBK can explain the byte (0x80 and 0xF5-0xFF are never
  // the first byte of a UTF-8 character). Inside it a single GBK pair and a
  // single UTF-8 character look the same, so wait for the next character.
  if (firstHigh < 0xc2 || firstHigh > 0xf4) return 'gb18030'
  const gbTail = incompleteGb18030(pending)
  const gbkWhole = gbTail > 0 ? pending.subarray(0, pending.length - gbTail) : pending
  const utfTail = incompleteUtf8(pending)
  const utf8Whole = utfTail > 0 ? pending.subarray(0, pending.length - utfTail) : pending
  if (!gbkWhole.length || !utf8Whole.length) return 'wait'
  // Judge the buffer under both decodings instead of trusting the openings:
  // three-byte UTF-8 characters and GBK pairs both drag a trailing byte in.
  return compareScores(utf8Whole, gbkWhole)
}

/** Trim line terminators: a complete UTF-8 CRI line may end in CRLF. */
function stripLineEnds(text) {
  let end = text.length
  while (end > 0 && (text[end - 1] === '\n' || text[end - 1] === '\r')) end -= 1
  return text.slice(0, end)
}

/** Grade the same bytes decoded as UTF-8 and as GBK; higher score wins. */
export function compareScores(utf8Whole, gbkWhole) {
  const utf8Text = decodeStrict(utf8Whole)
  // Bytes that UTF-8 cannot place at all are a GBK pair or more. Checking this
  // first matters: a long Latin-1 run of replacement characters would otherwise
  // slip past the short-sample guard and be scored as if it were text.
  if (utf8Text === null) return 'gb18030'
  const gbkText = gb18030.decode(gbkWhole)
  // A correct UTF-8 CJK line is a tight run of three-byte characters followed by
  // ASCII; a GBK line read as UTF-8 leaves wide gaps of symbols in between.
  if (UTF8_CJK_RUN.test(stripLineEnds(utf8Text)) && countHighBytes(utf8Whole) % 3 === 0) return 'utf8'
  // Grade both readings as text. Cyrillic and Greek letters are what a GBK pair
  // turns into when read as UTF-8, so this alone settles most samples.
  const gbScore = scoreText(gbkText, 'gb18030')
  const utf8Score = scoreText(utf8Text, 'utf8')
  if (Math.abs(gbScore - utf8Score) >= 2) return gbScore > utf8Score ? 'gb18030' : 'utf8'
  // Short samples that read cleanly both ways stay open until the line ends:
  // one 0xC2-0xDF pair looks exactly like one Latin-1 letter.
  if (utf8Text.length < 16 && !utf8Text.includes('\r') && !utf8Text.includes('\n')) return 'wait'
  return gbScore > utf8Score ? 'gb18030' : 'utf8'
}

/** Bytes that start a multi-byte character in either encoding. */
function countHighBytes(buffer) {
  let count = 0
  for (const byte of buffer) if (byte >= 0x80) count += 1
  return count
}

/**
 * Decoder for a VRP console stream, which may be UTF-8 or GBK depending on the
 * machine eNSP runs on. Neither the platform nor the connection announces the
 * encoding, so it is decided from the text itself.
 *
 * Text that is plain ASCII goes out as it arrives, because both encodings
 * render it the same way. The encoding is decided once two high bytes have
 * arrived, and that decision lasts for the rest of the stream. If text had
 * already been shown by then, the call that decides hands over the whole stream
 * again with `replaced: true`, so the caller drops what it showed and takes the
 * correctly decoded text instead.
 *
 * After that, complete lines are released as soon as their terminator arrives
 * and the unfinished tail of the last line waits for the rest of it.
 */
/**
 * Index just past the last line break in `bytes`, or 0 when it has none.
 */
function lastLineEnd(bytes, final = false) {
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    if (bytes[i] === 0x0a) return i + 1
    // A lone CR is a break only at true end of stream: VRP sends CRLF, so a CR
    // that arrives by itself is still waiting for its LF.
    if (bytes[i] === 0x0d && (final || i + 1 < bytes.length)) return i + 1
  }
  return 0
}

/**
 * Counts how many bytes at the tail of `buffer` belong to an unfinished GBK
 * character, one that needs the next segment to be decoded.
 */
function incompleteGb18030(buffer) {
  // Walk forward over whole characters; whatever is left over at the end is an
  // unfinished character. A pair whose trail byte is outside 0x40-0xFE never
  // formed a character (the decoder replaces each byte on its own), so walking
  // past it as if it were a pair would misalign every later byte.
  let i = 0
  while (i < buffer.length) {
    const byte = buffer[i]
    if (byte < 0x81 || byte > 0xfe) { i += 1; continue }
    if (i + 1 >= buffer.length) return 1
    const second = buffer[i + 1]
    if (second < 0x40 || second > 0xfe || second === 0x7f) { i += 1; continue }
    // GBK leads above 0xA0 may take an ASCII digit trail (the 4-byte form).
    if (second >= 0x30 && second <= 0x39 && byte > 0xa0) {
      if (i + 3 >= buffer.length) return buffer.length - i
      i += 4
      continue
    }
    i += 2
  }
  return 0
}

/**
 * Counts how many bytes at the tail of `buffer` belong to a multi-byte UTF-8
 * character that has not fully arrived yet. Returns 0 when the buffer ends on a
 * character boundary.
 */
function incompleteUtf8(buffer) {
  const limit = Math.min(4, buffer.length)
  for (let back = 1; back <= limit; back += 1) {
    const lead = buffer[buffer.length - back]
    let need = 0
    if (lead >= 0xc2 && lead <= 0xdf) need = 2
    else if (lead >= 0xe0 && lead <= 0xef) need = 3
    else if (lead >= 0xf0 && lead <= 0xf4) need = 4
    else if (lead < 0x80) return 0 // ASCII byte: everything after it is whole
    if (need > 0) return back < need ? back : 0
  }
  return 0
}

/** Bytes at the end of `bytes` that belong to an unfinished character. */
function incomplete(mode, bytes) {
  return mode === 'gb18030' ? incompleteGb18030(bytes) : incompleteUtf8(bytes)
}

/**
 * Bytes of a lone CR that may still turn out to be the start of a CRLF. VRP
 * ends every line with CRLF, so a CR at the very end of a segment is not a line
 * end yet and its line stays buffered until the next segment decides.
 */
function trailingCr(bytes) {
  return bytes.length > 0 && bytes[bytes.length - 1] === 0x0d ? 1 : 0
}

/**
 * How many bytes can be released now as a run of whole characters: everything
 * except an unfinished character and a dangling CR at the end.
 */
function releasable(mode, bytes, final) {
  if (final) return bytes.length
  return Math.max(0, bytes.length - incomplete(mode, bytes) - trailingCr(bytes))
}

/** Decode one stretch of complete characters in the settled encoding. */
function decodeLine(bytes, mode) {
  if (!bytes.length) return ''
  const decoded = mode === 'gb18030' ? gb18030.decode(bytes) : decodeStrict(bytes)
  return decoded === null ? gb18030.decode(bytes) : decoded
}

/**
 * Decoder for a VRP console stream, which is UTF-8 or GBK depending on the
 * machine eNSP runs on. Neither the platform nor the connection announces the
 * encoding, so it is decided from the text itself.
 *
 * Until the encoding is settled the decoder keeps every byte it has shown and
 * decodes the stream line by line once it knows. When the guess changes it
 * returns `replaced: true` and the whole text again, so the caller can drop
 * what it showed and take this instead; nothing is ever half decoded.
 *
 * Once settled, complete lines are released as soon as their terminator
 * arrives and the unfinished tail of the last line waits for the rest of it.
 */
export function createLineDecoder() {
  let buf = Buffer.alloc(0)
  let mode = 'pending'
  let settled = false
  // Bytes behind the text that has been handed out. While the encoding is
  // unknown that text came out as ASCII, so these bytes give it all back.
  let shown = Buffer.alloc(0)

  const settle = (current) => {
    if (settled) return false
    let high = 0
    for (const byte of buf) if (byte >= 0x80) high += 1
    // Two high bytes are the least that can tell UTF-8 from GBK apart, and both
    // must have arrived: deciding on the first of a pair is how a GBK prompt
    // used to be mistaken for Latin-1 text.
    if (high < 2) return false
    const at = buf.findIndex((byte) => byte >= 0x80)
    const decided = decideStream(buf.subarray(at), buf[at])
    if (decided === 'wait') return false
    mode = decided
    settled = true
    // Anything already shown was decoded without knowing the encoding. The
    // caller is told to drop it and is given the whole stream again, decoded
    // properly. Nothing is shown before the decision but ASCII, which either
    // encoding renders the same, so the replay is exact.
    if (current.length || shown.length) {
      buf = Buffer.concat([shown, buf])
      shown = Buffer.alloc(0)
      return true
    }
    return false
  }

  const drain = (final) => {
    let out = ''
    let replaced = settle(out)
    for (;;) {
      const end = lastLineEnd(buf, final)
      if (end > 0) {
        out += decodeLine(buf.subarray(0, end), mode)
        if (!settled) shown = Buffer.concat([shown, buf.subarray(0, end)])
        buf = Buffer.from(buf.subarray(end))
        continue
      }
      // No line break. A prompt is often written without one, so text is never
      // held back. In pending mode the bytes are plain ASCII until a high byte
      // turns up, and everything shown is taken back with 'replaced' when the
      // encoding is finally known, so releasing it early costs nothing.
      const cut = releasable(mode, buf, final)
      if (cut > 0) {
        out += decodeLine(buf.subarray(0, cut), mode)
        if (!settled) shown = Buffer.concat([shown, buf.subarray(0, cut)])
        buf = Buffer.from(buf.subarray(cut))
      }
      break
    }
    // Whatever is shown before the encoding is known also comes back on replay.
    if (!replaced) replaced = settle(out)
    return { text: out, replaced }
  }

  return {
    write(chunk) {
      const bytes = Buffer.from(chunk)
      buf = buf.length ? Buffer.concat([buf, bytes]) : Buffer.from(bytes)
      return drain(false)
    },
    end() {
      return drain(true)
    },
    get encoding() {
      return mode
    },
  }
}

export function repairMojibake(text) {
  if (typeof text !== 'string' || !text) return text
  const source = text
  // GBK text misread as UTF-8 leaves U+FFFD (bytes it could not place) and
  // stray Latin-1 letters. A clean name has neither.
  if (!/[\uFFFD\u0080-\u00FF]/.test(source)) return source
  try {
    // Bytes the old decoder lost are unrecoverable, so the repaired string can
    // never be longer than the source. Try dropping none, one, or two holes,
    // and keep the first candidate that is entirely readable.
    const holes = source.includes('\uFFFD') ? dropCandidates(source) : [source]
    for (const candidate of holes) {
      const repaired = gb18030.decode(Buffer.from(candidate, 'latin1'))
      if (!repaired || repaired === source) continue
      const readable = (repaired.match(/[\u4e00-\u9fff\u3040-\u30ff\u3041-\u30ffA-Za-z0-9._-]/g) || []).length
      if (readable / repaired.length < 0.6) continue
      if (/[\uFFFD\u0000-\u0008]/.test(repaired)) continue
      return repaired
    }
    return source
  } catch {
    return source
  }
}

/** Candidate byte strings for a mojibake name, dropping 0/1/2 lost bytes. */
function dropCandidates(source) {
  const out = []
  const plain = source.replace(/\uFFFD/g, '')
  out.push(plain)
  const holes = []
  for (let i = 0; i < source.length; i += 1) if (source[i] === '\uFFFD') holes.push(i)
  for (const drop of holes) out.push(source.slice(0, drop) + source.slice(drop + 1))
  return out
}

/**
 * Minimal RFC 854 parser. It strips Telnet commands from the byte stream and
 * refuses every option, which is enough for Huawei VRP console sessions.
 */
export class TelnetParser {
  constructor() {
    this.state = 'data'
    this.pendingVerb = 0
    this.decoder = createLineDecoder()
  }

  push(chunk) {
    const out = []
    const replies = []
    // A line ending ends the push window: whatever came before it cannot be the
    // first byte of a UTF-8 character split across segments.
    let lineEnded = false
    for (const byte of chunk) {
      if (this.state === 'data') {
        if (byte === IAC) this.state = 'iac'
        else {
          if (byte === 0x0a || byte === 0x0d) lineEnded = true
          out.push(byte)
        }
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
    const decoded = this.decoder.write(Buffer.from(out))
    return {
      text: decoded.text,
      replaced: decoded.replaced,
      replies: Buffer.from(replies),
    }
  }
  end() {
    const decoded = this.decoder.end()
    return { text: decoded.text, replaced: decoded.replaced }
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
        if (parsed.replaced) {
          // The stream turned out to be GBK, so everything captured so far was
          // decoded as UTF-8 garbage. Start over with the correctly decoded text.
          this.text = ''
        }
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
      if (parsed.replaced) text = ''
      text += parsed.text
      if (text.length > 4096) text = text.slice(-4096)
    })
    socket.once('error', (error) => {
      finish({ open: false, host, port, error: error instanceof Error ? error.message : String(error) })
    })
  })
}
