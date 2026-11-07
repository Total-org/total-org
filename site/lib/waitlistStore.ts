/**
 * Waitlist storage: an Upstash Redis database (Vercel Marketplace) spoken to over its REST API
 * with plain fetch — no SDK. It is OFF until the owner adds the store: the Marketplace
 * integration sets KV_REST_API_URL + KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN when
 * connected directly). Without them the page shows "opens soon" and nothing is sent anywhere.
 *
 * Keys: `waitlist` (hash: e-mail → {"at": ISO time}; HSETNX, so a second sign-up of the same
 * address changes nothing) and `waitlist:rl:<window>:<salted ip hash>` / `waitlist:rl:<window>:all` (counters,
 * expire with their window).
 */
import 'server-only'
import { GLOBAL_LIMIT, RATE_LIMIT, RATE_WINDOW_S, entriesFromHash, rateWindow, type WaitlistEntry } from './waitlist'

const URL_ENV = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const TOKEN_ENV = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const WAITLIST_KEY = 'waitlist'

export function waitlistEnabled(): boolean {
  return Boolean(URL_ENV && TOKEN_ENV)
}

type Command = (string | number)[]

async function pipeline(commands: Command[]): Promise<unknown[]> {
  if (!URL_ENV || !TOKEN_ENV) throw new Error('waitlist store is not configured')
  const res = await fetch(`${URL_ENV.replace(/\/$/, '')}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN_ENV}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(commands.map((c) => c.map(String))),
    cache: 'no-store',
    signal: AbortSignal.timeout(5000)
  })
  if (!res.ok) throw new Error(`waitlist store answered ${res.status}`)
  const data = (await res.json()) as { result?: unknown; error?: string }[]
  const failed = data.find((d) => d.error)
  if (failed) throw new Error(`waitlist store: ${failed.error}`)
  return data.map((d) => d.result)
}

/** Counts this try against the connection's and everyone's window; true while both are within limits. */
export async function withinRateLimit(ipHash: string, nowMs = Date.now()): Promise<boolean> {
  const slot = rateWindow(nowMs)
  const key = `${WAITLIST_KEY}:rl:${slot}:${ipHash}`
  const all = `${WAITLIST_KEY}:rl:${slot}:all`
  const [count, , total] = await pipeline([
    ['INCR', key],
    ['EXPIRE', key, RATE_WINDOW_S * 2],
    ['INCR', all],
    ['EXPIRE', all, RATE_WINDOW_S * 2]
  ])
  if (Number(total) > GLOBAL_LIMIT) console.error(`waitlist: more than ${GLOBAL_LIMIT} tries in one window; refusing until it ends`)
  return Number(count) <= RATE_LIMIT && Number(total) <= GLOBAL_LIMIT
}

/** Adds the address once; a repeat leaves the first sign-up time as it was. */
export async function addToWaitlist(email: string, nowMs = Date.now()): Promise<void> {
  await pipeline([['HSETNX', WAITLIST_KEY, email, JSON.stringify({ at: new Date(nowMs).toISOString() })]])
}

export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const [flat] = await pipeline([['HGETALL', WAITLIST_KEY]])
  return entriesFromHash(flat)
}
