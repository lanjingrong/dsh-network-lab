// Run every test file as separate processes.
// `node --test` is avoided on purpose: on some Windows sandboxes it fails with spawn EPERM.
// Each child writes to a file and this runner prints the file, so a single delegated
// child process (as used by this environment's tooling) never needs a pipe of its own
// beyond one level.
import { readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'

const files = readdirSync('test').filter((f) => f.endsWith('.test.js')).sort()
const rows = []
let total = 0
let pass = 0
let fail = 0
const started = Date.now()

for (const file of files) {
  const log = path.join(tmpdir(), 'netlab-' + process.pid + '-' + file + '.log')
  // shell:true + stdio:'ignore' keeps the child off our pipes; the log is read afterwards.
  const r = spawnSync(process.execPath + ' test/' + file + ' > "' + log + '" 2>&1', { shell: true, stdio: 'ignore' })
  let out = ''
  try { out = readFileSync(log, 'utf8') } catch {}
  try { rmSync(log, { force: true }) } catch {}
  const num = (label) => {
    const m = out.match(new RegExp('\\u2139 ' + label + ' (\\d+)'))
    return m ? Number(m[1]) : null
  }
  const t = num('tests')
  const p = num('pass')
  const x = num('fail')
  if (t === null) {
    rows.push({ file, status: 'ERROR', detail: 'no test output (status ' + r.status + ')' })
    continue
  }
  total += t
  pass += p
  fail += x
  rows.push({ file, status: x === 0 ? 'PASS' : 'FAIL', detail: p + '/' + t })
}

const width = Math.max(...files.map((f) => f.length))
let errors = 0
for (const row of rows) {
  if (row.status === 'ERROR') errors += 1
  console.log(row.status.padEnd(6) + row.file.padEnd(width + 2) + row.detail)
}
console.log('')
console.log('total ' + pass + '/' + total + ' passed, ' + fail + ' failed' + (errors ? ', ' + errors + ' file(s) could not run' : '') + ', ' + ((Date.now() - started) / 1000).toFixed(1) + 's')
process.exitCode = fail || errors ? 1 : 0
