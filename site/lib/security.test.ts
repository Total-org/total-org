// CSP and security headers (audit 2026-11 SEC-7, A6): `npm test` (node --test).
// The /api routes must keep answering installed apps exactly as before: no proxy, no added header.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { contentSecurityPolicy, newNonce, SECURITY_HEADERS, siteHeaders } from './security.ts'

function directives(csp: string): Map<string, string[]> {
  return new Map(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))
}

test('production CSP: nonce + strict-dynamic scripts, nothing inline or eval, no framing', () => {
  const d = directives(contentSecurityPolicy('abc123=='))
  assert.deepEqual(d.get('script-src'), ["'self'", "'nonce-abc123=='", "'strict-dynamic'"])
  assert.deepEqual(d.get('style-src'), ["'self'", "'nonce-abc123=='"])
  assert.deepEqual(d.get('default-src'), ["'self'"])
  assert.deepEqual(d.get('object-src'), ["'none'"])
  assert.deepEqual(d.get('base-uri'), ["'none'"])
  assert.deepEqual(d.get('frame-ancestors'), ["'none'"])
  assert.deepEqual(d.get('form-action'), ["'self'"])
  assert.deepEqual(d.get('connect-src'), ["'self'"])
  // Only style ATTRIBUTES may be inline (next/image's style="color:transparent"); never a script.
  for (const [name, values] of d) {
    if (name === 'style-src-attr') continue
    assert.ok(!values.includes("'unsafe-inline'") && !values.includes("'unsafe-eval'"), name)
    assert.ok(!values.some((v) => v === '*' || v.endsWith(':') && !['data:', 'blob:'].includes(v)), name)
  }
})

test('dev CSP adds only what React dev needs (eval, inline styles)', () => {
  const d = directives(contentSecurityPolicy('n', true))
  assert.deepEqual(d.get('script-src'), ["'self'", "'nonce-n'", "'strict-dynamic'", "'unsafe-eval'"])
  assert.deepEqual(d.get('style-src'), ["'self'", "'unsafe-inline'"])
})

test('newNonce: 128 random bits, base64, new every time', () => {
  const seen = new Set<string>()
  for (let i = 0; i < 200; i++) {
    const n = newNonce()
    assert.match(n, /^[A-Za-z0-9+/]{22}==$/)
    seen.add(n)
  }
  assert.equal(seen.size, 200)
})

test('the security headers', () => {
  assert.deepEqual(Object.fromEntries(SECURITY_HEADERS.map((h) => [h.key, h.value])), {
    'Strict-Transport-Security': 'max-age=63072000',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy':
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=(), midi=(), magnetometer=(), gyroscope=(), accelerometer=(), display-capture=(), browsing-topics=()',
    'Cross-Origin-Opener-Policy': 'same-origin'
  })
})

/** A next.config source (`/`, `/:path(<re>)`) as the RegExp path-to-regexp makes of it. */
function sourceRegExp(source: string): RegExp {
  if (source === '/') return /^\/$/
  const m = /^\/:path\((.*)\)$/.exec(source)
  assert.ok(m, source)
  return new RegExp(`^/(?:${m[1]})$`)
}

const API_PATHS = ['/api/latest', '/api/download', '/api/download?platform=win', '/api/waitlist/export', '/api/waitlist/remove', '/api']
const PAGES = ['/', '/docs', '/docs/faq', '/changelog', '/compare', '/privacy', '/apis', '/_next/static/chunks/x.js', '/shots/home-light.png']

test('siteHeaders: every page and static file, never /api', () => {
  const rules = siteHeaders().map((r) => sourceRegExp(r.source))
  const covered = (p: string): boolean => rules.some((re) => re.test(p.split('?')[0]))
  for (const p of API_PATHS) assert.equal(covered(p), false, p)
  for (const p of PAGES) assert.equal(covered(p), true, p)
})

test('proxy.ts (the CSP) runs on pages only — never /api, static files or prefetches', () => {
  const src = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8')
  // Next reads the matcher statically from the file, so the test reads the same text.
  const m = /source: '(.*)',/.exec(src)
  assert.ok(m)
  const source = m[1].replace(/\\\\/g, '\\')
  assert.ok(source.startsWith('/(') && source.endsWith(')'), source)
  const re = new RegExp(`^/(?:${source.slice(2, -1)})$`)
  const runs = (p: string): boolean => re.test(p.split('?')[0])
  for (const p of [...API_PATHS, '/_next/static/chunks/x.js', '/_next/image', '/icon.png', '/icon-64.png', '/shots/home-light.png', '/opengraph-image', '/favicon.ico']) {
    assert.equal(runs(p), false, p)
  }
  for (const p of ['/', '/docs', '/docs/faq', '/changelog', '/compare', '/privacy', '/apis', '/no-such-page']) assert.equal(runs(p), true, p)
  assert.match(src, /key: 'next-router-prefetch'/)
})
