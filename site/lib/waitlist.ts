/**
 * Waitlist rules that need no network: e-mail checks, the IP key used for rate limiting
 * (hashed, never stored raw) and the CSV the owner exports. Tested by `npm test`
 * (lib/waitlist.test.ts, node --test).
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export const EMAIL_MAX = 254

/** Lower-cased, trimmed address, or null when it can't be a real e-mail. */
export function normaliseEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const email = raw.trim().toLowerCase()
  if (email.length < 6 || email.length > EMAIL_MAX) return null
  // One @, a non-empty local part without spaces, a domain with a dot and a 2+ letter ending.
  if (!/^[^\s@<>"',;]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/.test(email)) return null
  const [local] = email.split('@')
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null
  return email
}

/** The first address in x-forwarded-for (Vercel puts the client first), else x-real-ip. */
export function clientIp(forwardedFor: string | null, realIp: string | null): string {
  const first = forwardedFor?.split(',')[0]?.trim()
  return first || realIp?.trim() || 'unknown'
}

/** IPv6 addresses count by their /64 (one home or phone gets a whole /64 to rotate through). */
export function ipBucket(ip: string): string {
  if (!ip.includes(':')) return ip
  const [head] = ip.split('%')
  // An IPv4 address written as IPv6 (::ffff:203.0.113.7) counts as that IPv4 address.
  const last = head.split(':').pop() ?? ''
  if (last.includes('.')) return last
  const halves = head.split('::')
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length > 1 && halves[1] ? halves[1].split(':') : []
  const groups = halves.length > 1 ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right] : left
  return `${groups.slice(0, 4).map((g) => (g || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':')}::/64`
}

/** Rate-limit key: a salted hash, so raw IP addresses are never written anywhere. */
export function ipKey(ip: string, salt: string): string {
  return createHash('sha256').update(`${salt}:${ipBucket(ip)}`).digest('hex').slice(0, 32)
}

/**
 * Fixed window the limits count in (seconds); tries per connection in it (generous: Indian mobile
 * networks put many people behind one address); tries from everyone together in it (a flood stops
 * here and the store never grows without bound).
 */
export const RATE_WINDOW_S = 600
export const RATE_LIMIT = 20
export const GLOBAL_LIMIT = 600

export function rateWindow(nowMs: number): number {
  return Math.floor(nowMs / 1000 / RATE_WINDOW_S)
}

/** Constant-time check of the export token; false when none is configured or it's too short. */
export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || expected.length < 24 || !given) return false
  const a = createHash('sha256').update(given).digest()
  const b = createHash('sha256').update(expected).digest()
  return timingSafeEqual(a, b)
}

export interface WaitlistEntry {
  email: string
  joinedAt: string
}

function csvCell(value: string): string {
  // Quote everything; neutralise spreadsheet formulas (=, +, -, @ at the start).
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replace(/"/g, '""')}"`
}

/** Oldest first, header row, CRLF (what Excel / Sheets expect). */
export function toCsv(entries: WaitlistEntry[]): string {
  const rows = [...entries].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.email.localeCompare(b.email))
  return ['email,joined_at', ...rows.map((e) => `${csvCell(e.email)},${csvCell(e.joinedAt)}`)].join('\r\n') + '\r\n'
}

/** HGETALL's flat [field, value, field, value …] → entries; bad rows are skipped. */
export function entriesFromHash(flat: unknown): WaitlistEntry[] {
  if (!Array.isArray(flat)) return []
  const out: WaitlistEntry[] = []
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const email = flat[i]
    const value = flat[i + 1]
    if (typeof email !== 'string') continue
    let joinedAt = ''
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as { at?: unknown }
        if (typeof parsed.at === 'string') joinedAt = parsed.at
      } catch {
        joinedAt = ''
      }
    }
    out.push({ email, joinedAt })
  }
  return out
}
