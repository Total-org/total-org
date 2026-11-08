/**
 * The site's Content-Security-Policy and security headers (audit 2026-11 SEC-7, work package A6).
 *
 * - CSP: a fresh nonce per page request, set by proxy.ts (Next.js reads it from the request's CSP
 *   header and puts it on its own scripts; the root layout renders every page per request so the
 *   nonce can be applied). No 'unsafe-inline' / 'unsafe-eval' for scripts in production; style
 *   ATTRIBUTES are allowed ('unsafe-inline' in style-src-attr only — next/image writes
 *   `style="color:transparent"`; an attribute style cannot run script). Everything else is 'self'.
 * - The other headers (`siteHeaders`, next.config.ts) go on every page and static file.
 * - **Nothing under /api gets any of this**: /api/latest and /api/download answer every installed app (also on
 *   the old devjindal.tech host) exactly as before — no proxy, no added header. Tested by
 *   lib/security.test.ts (node --test) together with redirects.test.ts.
 */
import { NOT_API } from './redirects.ts'

/** 128 random bits, base64 — unguessable and new for every request. */
export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export function contentSecurityPolicy(nonce: string, dev = false): string {
  const directives: [string, ...string[]][] = [
    ['default-src', "'self'"],
    // 'strict-dynamic': scripts the nonced Next.js runtime loads are trusted; 'self' is ignored by
    // browsers that understand it and kept for those that don't. React's dev build needs eval.
    ['script-src', "'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])],
    ['style-src', "'self'", ...(dev ? ["'unsafe-inline'"] : [`'nonce-${nonce}'`])],
    ['style-src-attr', "'unsafe-inline'"],
    ['img-src', "'self'", 'data:', 'blob:'],
    ['font-src', "'self'"],
    ['connect-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['form-action', "'self'"],
    ['frame-ancestors', "'none'"],
    ['frame-src', "'none'"],
    ['worker-src', "'self'"],
    ['manifest-src', "'self'"]
  ]
  return directives.map((d) => d.join(' ')).join('; ')
}

/** Sent with every page and static file (nothing under /api). */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  // Two years. No includeSubDomains / preload: the old devjindal.tech host may have other
  // subdomains that are not ours to pin to https.
  { key: 'Strict-Transport-Security', value: 'max-age=63072000' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // CSP frame-ancestors 'none' says the same to current browsers; this is for older ones.
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()'
  },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }
]

/** next.config.ts headers(): the same paths the redirects treat as pages — never /api. */
export function siteHeaders(): { source: string; headers: { key: string; value: string }[] }[] {
  return [
    { source: '/', headers: SECURITY_HEADERS },
    { source: `/:path(${NOT_API})`, headers: SECURITY_HEADERS }
  ]
}
