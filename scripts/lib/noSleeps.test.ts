// Audit A11 / HEALTH-7 (CLAUDE.md WP 7.4: fix a flake at its root, "never with retries or sleeps"):
// no e2e scenario, journey or harness file waits a fixed time. Wait on a condition instead —
// a selector / waitForFunction, h.waitIdle(), waitForSettled (nothing loading, no
// running animation), h.frames() / h.ipcDrained() for "nothing happened" checks, until() for a
// Node-side condition (an IPC read, a file on disk).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

const SCRIPTS = join(__dirname, '..')

describe('e2e: no fixed sleeps', () => {
  it('no waitForTimeout in scripts/e2e or scripts/lib', () => {
    const hits: string[] = []
    for (const dir of ['e2e', 'lib']) {
      for (const f of readdirSync(join(SCRIPTS, dir), { recursive: true }) as string[]) {
        if (!/\.m?js$/.test(f)) continue
        readFileSync(join(SCRIPTS, dir, f), 'utf8').split('\n').forEach((line, i) => {
          if (/\.waitForTimeout\(/.test(line)) hits.push(`${dir}/${f}:${i + 1}`)
        })
      }
    }
    expect(hits).toEqual([])
  })
})
