// Audit 2 SEC2-3: a PACKAGED build must refuse to start with a remote-debugging switch
// (src/main/debugSwitches.ts). Launches <exe> with each switch on a scratch data dir and fails
// unless it exits with code 1 before showing a window. Run on the SHIPPED build (not the
// fuse-flipped smoke copy, whose running Node inspector is the one allowed exception).
//
//   node scripts/debug-switch-check.mjs <exe>
import { spawn } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const exe = process.argv[2]
if (!exe) {
  console.error('usage: node scripts/debug-switch-check.mjs <exe>')
  process.exit(2)
}
const SWITCHES = ['--remote-debugging-port=0', '--remote-debugging-pipe']
const LIMIT_MS = 60_000

function launch(flag) {
  const data = mkdtempSync(join(tmpdir(), 'total-debug-check-'))
  const env = { ...process.env, TOTAL_DATA_DIR: data, TOTAL_SUPPRESS_SYNC_WARNING: '1', TOTAL_NO_UPDATE_CHECK: '1', TOTAL_INSECURE_TEST_SECRETS: '1' }
  for (const k of Object.keys(env)) if (k.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[k]
  return new Promise((resolve) => {
    // The pipe switch makes Chromium read fds 3 / 4: give it pipes so it can't fail on that first.
    const child = spawn(exe, [flag], { env, stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => (err += d))
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve({ code: 'still running', err })
    }, LIMIT_MS)
    child.on('exit', (code) => {
      clearTimeout(timer)
      rmSync(data, { recursive: true, force: true })
      resolve({ code, err })
    })
  })
}

let failed = false
for (const flag of SWITCHES) {
  const { code, err } = await launch(flag)
  const ok = code === 1 && /does not start with/.test(err)
  console.log(`[debug-switch] ${flag}: ${ok ? 'refused' : `NOT refused (exit ${code})`}`)
  if (!ok) {
    failed = true
    if (err) console.error(err.slice(0, 2000))
  }
}
process.exit(failed ? 1 : 0)
