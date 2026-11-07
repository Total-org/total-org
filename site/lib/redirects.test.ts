// Redirect rules: `npm test` (node --test). The live check is the curl matrix on the PR.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANONICAL_HOST, NOT_API, OLD_HOSTS, siteRedirects } from './redirects.ts'

const notApi = new RegExp(`^${NOT_API}$`)

test('NOT_API keeps every /api path on the old host and moves every page', () => {
  for (const p of ['api', 'api/latest', 'api/download', 'api/waitlist/export']) assert.equal(notApi.test(p), false, p)
  for (const p of ['', 'docs', 'docs/gst', 'apis', 'apidocs', 'privacy', 'x/api/latest']) assert.equal(notApi.test(p), true, p)
})

test('every rule is a permanent (308) redirect to the canonical https host', () => {
  const rules = siteRedirects()
  for (const r of rules) {
    assert.equal(r.permanent, true)
    assert.ok(r.destination.startsWith(`https://${CANONICAL_HOST}/`), r.destination)
    assert.equal(r.has.length, 1)
    assert.notEqual(new RegExp(`^${r.has[0].value}$`).test(CANONICAL_HOST), true, 'never redirects the canonical host to itself')
  }
})

test('the old hosts keep /api (no rule matches it); www.irminflow.com moves everything', () => {
  const rules = siteRedirects()
  for (const host of OLD_HOSTS) {
    const own = rules.filter((r) => new RegExp(`^${r.has[0].value}$`).test(host))
    assert.deepEqual(own.map((r) => r.source).sort(), ['/', `/:path(${NOT_API})`].sort(), host)
    assert.ok(own.every((r) => !r.source.includes(':path*')), 'no catch-all on an old host')
  }
  const www = rules.filter((r) => new RegExp(`^${r.has[0].value}$`).test(`www.${CANONICAL_HOST}`))
  assert.deepEqual(www.map((r) => [r.source, r.destination]), [['/:path*', `https://${CANONICAL_HOST}/:path*`]])
})
