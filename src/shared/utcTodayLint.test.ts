// Audit COR-4 / audit 2 #10: "today" is the LOCAL date (`dates.ts` `todayISO`). `new Date().toISOString()`
// is UTC — a day behind in India from 00:00 to 05:30 — so it never stands for today in app code.
// (Date arithmetic on a UTC-built date, e.g. `new Date(Date.UTC(y, m, d)).toISOString()`, is fine.)
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, resolve } from 'path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '..')
const ROOTS = ['main', 'renderer/src', 'shared', 'preload'].map((r) => join(SRC, r))
const UTC_TODAY = /new Date\(\s*(?:Date\.now\(\)\s*)?\)\s*\.toISOString\(\)\s*\.slice\(\s*0\s*,\s*10\s*\)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) return f === 'fixtures' || f === '__fixtures__' ? [] : files(p)
    return /\.tsx?$/.test(f) && !/\.(db)?test\.tsx?$|\.testutil\.ts$/.test(f) ? [p] : []
  })
}

describe('no UTC "today" in app code', () => {
  it('nothing writes today as new Date().toISOString().slice(0, 10)', () => {
    const offenders = ROOTS.flatMap((root) =>
      files(root).flatMap((file) =>
        readFileSync(file, 'utf8').split('\n').flatMap((line, i) => (UTC_TODAY.test(line) ? [`${relative(SRC, file)}:${i + 1}`] : []))
      )
    )
    expect(offenders).toEqual([])
  })
})
