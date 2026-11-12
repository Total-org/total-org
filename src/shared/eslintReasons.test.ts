// Audit A11 / HEALTH-9: every eslint-disable in src/ says why, on the same line
// (`eslint-disable-next-line <rule> -- <reason>`), so a disabled rule is a decision someone
// can check, not a silenced warning. src/shared/fixtures/ is frozen old code and is not linted.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'

const SRC = join(__dirname, '..')
/** A rule name (not ` -- `, which would switch off every rule), then ` -- ` and a reason. */
const HAS_REASON = /eslint-disable(?:-next-line|-line)? (?!--)[\w@/-]+.* -- \S/

describe('eslint-disable reasons', () => {
  it('a directive needs a rule name and a reason', () => {
    expect(HAS_REASON.test('// eslint-disable-next-line react-hooks/exhaustive-deps -- on mount only')).toBe(true)
    expect(HAS_REASON.test('// eslint-disable-next-line react-hooks/exhaustive-deps')).toBe(false)
    expect(HAS_REASON.test('// eslint-disable-next-line -- x -- y')).toBe(false)
  })

  it('every disable in src names its rule and gives a reason', () => {
    const bad: string[] = []
    for (const f of readdirSync(SRC, { recursive: true }) as string[]) {
      const rel = f.split('\\').join('/')
      if (!/\.(ts|tsx)$/.test(rel) || rel.startsWith('shared/fixtures/') || rel === 'shared/eslintReasons.test.ts') continue
      readFileSync(join(SRC, f), 'utf8').split('\n').forEach((line, i) => {
        if (/(\/\/|\/\*)\s*eslint-disable/.test(line) && !HAS_REASON.test(line)) bad.push(`${relative(SRC, join(SRC, f))}:${i + 1}`)
      })
    }
    expect(bad).toEqual([])
  })
})
