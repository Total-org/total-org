/**
 * Stored screen locks (1.0 readiness SEC2-6, decision Q6). The screen lock of a business WITHOUT
 * people whose passphrase lock is on (⌘L / its idle minutes — ipc.ts `lockPrivacy`) is written
 * here, outside the books, by slug: while it is set, every open of that business asks for the
 * passphrase — a key "remembered on this computer" included — and only a correct passphrase clears
 * it. Without it "Switch business" or a restart got past the lock (the in-memory lock was dropped
 * on close and the remembered key opened the books again).
 *
 * One small JSON file beside app-settings.json under the data root (`screen-locks.json`, copied by
 * a data-folder move with the rest): `{ "<slug>": { "since": ISO time, "reason": "manual" | "idle" } }`.
 * A file that exists but can't be read fails CLOSED: every business counts as locked until a
 * passphrase opens one, which writes the file afresh with every OTHER business still locked.
 * The lock and its clearing are audited inside the books (ipc.ts: the `user` logout / login rows).
 * Pure Node (fs/path): the root is injected, so it is unit-testable.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { renameReplacing } from '../fsRetry'

const FILE = 'screen-locks.json'

export type ScreenLockReason = 'manual' | 'idle'
export interface StoredScreenLock {
  since: string
  reason: ScreenLockReason
}
interface LockFile {
  locks: Record<string, StoredScreenLock>
  /** The file exists but is not a lock file (damaged / hand-edited): fail closed. */
  unreadable: boolean
}

const isReason = (v: unknown): v is ScreenLockReason => v === 'manual' || v === 'idle'

/** Missing file = no locks. `onCorrupt` hears about a file that exists but cannot be read. */
function readLockFile(root: string, onCorrupt?: (error: string) => void): LockFile {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(join(root, FILE), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { locks: {}, unreadable: false }
    onCorrupt?.(String(err))
    return { locks: {}, unreadable: true }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    onCorrupt?.('not an object')
    return { locks: {}, unreadable: true }
  }
  const locks: Record<string, StoredScreenLock> = {}
  for (const [slug, v] of Object.entries(raw)) {
    const e = v as Partial<StoredScreenLock> | null
    // An entry that is not a lock still names a business someone locked: kept as locked.
    locks[slug] = e && typeof e === 'object' && typeof e.since === 'string' && isReason(e.reason) ? { since: e.since, reason: e.reason } : { since: '', reason: 'manual' }
  }
  return { locks, unreadable: false }
}

function writeLockFile(root: string, locks: Record<string, StoredScreenLock>): void {
  mkdirSync(root, { recursive: true })
  const tmp = join(root, `${FILE}.tmp`)
  writeFileSync(tmp, JSON.stringify(locks, null, 2), { mode: 0o600 })
  renameReplacing(tmp, join(root, FILE))
}

/** Whether opening `slug` must ask for its passphrase because its screen was locked. */
export function isScreenLocked(root: string, slug: string, onCorrupt?: (error: string) => void): boolean {
  const f = readLockFile(root, onCorrupt)
  return f.unreadable || Object.hasOwn(f.locks, slug)
}

/** Store the lock of `slug` (an existing one keeps its first time and reason). Throws when the
 *  file can't be written — the caller keeps its in-memory lock and logs it. */
export function storeScreenLock(root: string, slug: string, reason: ScreenLockReason, at: string, knownSlugs: readonly string[], onCorrupt?: (error: string) => void): void {
  const f = readLockFile(root, onCorrupt)
  if (!f.unreadable && Object.hasOwn(f.locks, slug)) return
  writeLockFile(root, { ...(f.unreadable ? lockAll(knownSlugs, at) : f.locks), [slug]: { since: at, reason } })
}

/** Clear the lock of `slug` (its passphrase was just typed right). A damaged file is replaced by
 *  one that keeps every other known business locked. Returns whether a lock was cleared. */
export function clearScreenLock(root: string, slug: string, at: string, knownSlugs: readonly string[], onCorrupt?: (error: string) => void): boolean {
  const f = readLockFile(root, onCorrupt)
  if (f.unreadable) {
    const rest = lockAll(knownSlugs.filter((s) => s !== slug), at)
    writeLockFile(root, rest)
    return true
  }
  if (!Object.hasOwn(f.locks, slug)) return false
  const rest = { ...f.locks }
  delete rest[slug]
  writeLockFile(root, rest)
  return true
}

/** Drop the lock of a business that is gone (deleted) — no passphrase is asked of nothing. */
export function forgetScreenLock(root: string, slug: string): void {
  if (!existsSync(join(root, FILE))) return
  const f = readLockFile(root)
  if (f.unreadable || !Object.hasOwn(f.locks, slug)) return
  const rest = { ...f.locks }
  delete rest[slug]
  writeLockFile(root, rest)
}

const lockAll = (slugs: readonly string[], at: string): Record<string, StoredScreenLock> =>
  Object.fromEntries(slugs.map((s) => [s, { since: at, reason: 'manual' as const }]))
