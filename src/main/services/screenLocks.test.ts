// 1.0 readiness SEC2-6: the stored screen lock file (fs only, scratch folder).
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { clearScreenLock, forgetScreenLock, isScreenLocked, storeScreenLock } from './screenLocks'

const roots: string[] = []
const scratch = (): string => {
  const r = mkdtempSync(join(tmpdir(), 'total-screen-locks-'))
  roots.push(r)
  return r
}
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true })
})
const AT = '2026-11-18T10:00:00.000Z'
const stored = (root: string): unknown => JSON.parse(readFileSync(join(root, 'screen-locks.json'), 'utf8'))

describe('stored screen locks', () => {
  it('no file = nothing locked; a stored lock stays until it is cleared, per business', () => {
    const root = scratch()
    expect(isScreenLocked(root, 'a')).toBe(false)
    storeScreenLock(root, 'a', 'idle', AT, ['a', 'b'])
    expect(isScreenLocked(root, 'a')).toBe(true)
    expect(isScreenLocked(root, 'b')).toBe(false)
    // A second lock keeps the first time and reason.
    storeScreenLock(root, 'a', 'manual', '2026-11-18T11:00:00.000Z', ['a', 'b'])
    expect(stored(root)).toEqual({ a: { since: AT, reason: 'idle' } })
    expect(clearScreenLock(root, 'b', AT, ['a', 'b'])).toBe(false)
    expect(clearScreenLock(root, 'a', AT, ['a', 'b'])).toBe(true)
    expect(isScreenLocked(root, 'a')).toBe(false)
    expect(stored(root)).toEqual({})
  })

  it('a damaged file fails closed: every business is locked until a passphrase clears one, which keeps the others locked', () => {
    const root = scratch()
    writeFileSync(join(root, 'screen-locks.json'), '{ not json')
    const heard: string[] = []
    expect(isScreenLocked(root, 'a', (e) => heard.push(e))).toBe(true)
    expect(isScreenLocked(root, 'b')).toBe(true)
    expect(heard).toHaveLength(1)
    expect(clearScreenLock(root, 'a', AT, ['a', 'b', 'c'])).toBe(true)
    expect(isScreenLocked(root, 'a')).toBe(false)
    expect(isScreenLocked(root, 'b')).toBe(true)
    expect(stored(root)).toEqual({ b: { since: AT, reason: 'manual' }, c: { since: AT, reason: 'manual' } })
    writeFileSync(join(root, 'screen-locks.json'), '[1]')
    expect(isScreenLocked(root, 'z')).toBe(true)
    // Storing a lock over a damaged file keeps every known business locked too.
    storeScreenLock(root, 'a', 'idle', AT, ['a', 'b'])
    expect(stored(root)).toEqual({ a: { since: AT, reason: 'idle' }, b: { since: AT, reason: 'manual' } })
  })

  it('an entry that is not a lock still locks its business; a deleted business’s lock is forgotten', () => {
    const root = scratch()
    writeFileSync(join(root, 'screen-locks.json'), JSON.stringify({ a: 'yes', b: { since: AT, reason: 'idle' } }))
    expect(isScreenLocked(root, 'a')).toBe(true)
    forgetScreenLock(root, 'a')
    expect(isScreenLocked(root, 'a')).toBe(false)
    expect(isScreenLocked(root, 'b')).toBe(true)
    forgetScreenLock(scratch(), 'x') // no file: nothing to do
  })
})
