// Audit 2026-11 A5 (SEC-4): the NIC API password and client secret belong to the portal they were
// saved for. Pure rules (no Electron, no DB) used by services/nic.ts:
//   - an address must be https:// — plain http:// only on this computer (localhost / 127.0.0.1 /
//     ::1, the e2e fake sandbox), never with a user name or password inside it;
//   - the secrets are BOUND to the origins of both addresses + a fingerprint of the NIC public key
//     they were saved with; when either changes the secrets are not sent (and a save that changes
//     them without retyping the secrets drops them) — the same rule as the custom AI service's key
//     (ai/providerConfig.ts `ai_bound_origin:custom`).

export type NicUrlProblem = 'not_url' | 'not_https' | 'has_login'

export type NicUrlCheck = { ok: true; origin: string } | { ok: false; code: NicUrlProblem; error: string }

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

export const NIC_URL_MESSAGES: Record<NicUrlProblem, string> = {
  not_url: 'This is not a web address — it should look like https://einv-apisandbox.nic.in',
  not_https: 'The address must start with https:// — the password and client secret are never sent over plain http',
  has_login: 'Leave the user name and password out of the address — type them in their own boxes'
}

/** Check one NIC base URL. '' (not set) is fine and has no origin. */
export function checkNicBaseUrl(raw: string): NicUrlCheck {
  const s = String(raw ?? '').trim()
  if (s === '') return { ok: true, origin: '' }
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return { ok: false, code: 'not_url', error: NIC_URL_MESSAGES.not_url }
  }
  if (u.username || u.password) return { ok: false, code: 'has_login', error: NIC_URL_MESSAGES.has_login }
  if (u.protocol === 'https:') return { ok: true, origin: u.origin }
  if (u.protocol === 'http:' && LOOPBACK.has(u.hostname)) return { ok: true, origin: u.origin }
  if (u.protocol === 'http:') return { ok: false, code: 'not_https', error: NIC_URL_MESSAGES.not_https }
  return { ok: false, code: 'not_url', error: NIC_URL_MESSAGES.not_url }
}

/** What the secrets are bound to: both addresses' origins and the public key's fingerprint. */
export interface NicBinding {
  einvoice: string
  ewb: string
  /** SHA-256 (hex) of the PEM with every blank removed ('' = no key). Computed by main. */
  pem: string
}

/** The origin of an address, or the address itself when it can't be read (never equal to a real origin). */
export function nicOriginOf(raw: string): string {
  const c = checkNicBaseUrl(raw)
  return c.ok ? c.origin : `invalid:${String(raw ?? '').trim()}`
}

export function sameNicBinding(a: NicBinding, b: NicBinding): boolean {
  return a.einvoice === b.einvoice && a.ewb === b.ewb && a.pem === b.pem
}

/** Parse a stored binding; anything unreadable = null (no binding recorded). */
export function parseNicBinding(raw: string | null): NicBinding | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Record<string, unknown>
    if (typeof v.einvoice === 'string' && typeof v.ewb === 'string' && typeof v.pem === 'string') return { einvoice: v.einvoice, ewb: v.ewb, pem: v.pem }
  } catch {
    // fall through
  }
  return null
}

/** Shown when the stored address / key no longer matches what the secrets were saved for. */
export const NIC_SECRETS_HELD_BACK =
  'The NIC address or public key changed outside Total, so the saved password and client secret are not sent there. Type them again in Settings → NIC live filing.'

/** Shown after a save that moved the address / key without retyping the secrets. */
export const NIC_SECRETS_DROPPED =
  'The address or public key changed, so the saved password and client secret were cleared — they only ever go to the portal they were typed for. Type them again and save.'
