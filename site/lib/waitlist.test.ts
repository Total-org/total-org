// Waitlist rules: `npm test` (node --test, Node's own TypeScript stripping — no extra packages).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clientIp, entriesFromHash, ipKey, normaliseEmail, rateWindow, RATE_WINDOW_S, toCsv, tokenMatches } from './waitlist.ts'

test('normaliseEmail accepts real addresses, trimmed and lower-cased', () => {
  assert.equal(normaliseEmail('  Ramesh.Kumar@Example.IN '), 'ramesh.kumar@example.in')
  assert.equal(normaliseEmail('ca+total@mail.co.in'), 'ca+total@mail.co.in')
  assert.equal(normaliseEmail('a@b.co'), 'a@b.co')
})

test('normaliseEmail refuses what cannot be an address', () => {
  for (const bad of ['', 'ramesh', 'ramesh@', '@example.com', 'a b@example.com', 'a@example', 'a@example.c', 'a@@example.com', '.a@example.com', 'a..b@example.com', 'a.@example.com', 'a@-example.com', '<a@example.com>', 'a@example.com,b@example.com', `${'x'.repeat(65)}@example.com`, `a@${'x'.repeat(250)}.com`, 42, null, undefined]) {
    assert.equal(normaliseEmail(bad), null, String(bad))
  }
})

test('clientIp takes the first forwarded address, then x-real-ip', () => {
  assert.equal(clientIp('203.0.113.7, 10.0.0.1', '10.0.0.2'), '203.0.113.7')
  assert.equal(clientIp(null, ' 198.51.100.4 '), '198.51.100.4')
  assert.equal(clientIp('', null), 'unknown')
})

test('ipKey is salted and never contains the address', () => {
  const k = ipKey('203.0.113.7', 'salt-a')
  assert.match(k, /^[0-9a-f]{32}$/)
  assert.notEqual(k, ipKey('203.0.113.7', 'salt-b'))
  assert.equal(k, ipKey('203.0.113.7', 'salt-a'))
  assert.ok(!k.includes('203'))
})

test('rateWindow changes every RATE_WINDOW_S seconds', () => {
  const t = 1_800_000_000_000
  const start = Math.floor(t / 1000 / RATE_WINDOW_S) * RATE_WINDOW_S * 1000
  assert.equal(rateWindow(start), rateWindow(start + RATE_WINDOW_S * 1000 - 1))
  assert.equal(rateWindow(start) + 1, rateWindow(start + RATE_WINDOW_S * 1000))
})

test('tokenMatches needs a configured token of 24+ characters and the exact value', () => {
  const token = 'abcdefghijklmnopqrstuvwxyz012345'
  assert.equal(tokenMatches(token, token), true)
  assert.equal(tokenMatches(token + 'x', token), false)
  assert.equal(tokenMatches(null, token), false)
  assert.equal(tokenMatches('', token), false)
  assert.equal(tokenMatches('short', 'short'), false)
  assert.equal(tokenMatches('anything', undefined), false)
})

test('entriesFromHash reads HGETALL pairs and skips junk', () => {
  const flat = ['b@example.com', '{"at":"2026-11-08T10:00:00.000Z"}', 'a@example.com', '{"at":"2026-11-07T09:00:00.000Z"}', 'c@example.com', 'not json', 7, '{}']
  assert.deepEqual(entriesFromHash(flat), [
    { email: 'b@example.com', joinedAt: '2026-11-08T10:00:00.000Z' },
    { email: 'a@example.com', joinedAt: '2026-11-07T09:00:00.000Z' },
    { email: 'c@example.com', joinedAt: '' }
  ])
  assert.deepEqual(entriesFromHash(null), [])
})

test('toCsv: header, oldest first, quoted, CRLF, formulas neutralised', () => {
  const csv = toCsv([
    { email: 'b@example.com', joinedAt: '2026-11-08T10:00:00.000Z' },
    { email: '=cmd@example.com', joinedAt: '2026-11-07T09:00:00.000Z' },
    { email: 'q"uote@example.com', joinedAt: '2026-11-09T09:00:00.000Z' }
  ])
  assert.equal(
    csv,
    'email,joined_at\r\n' +
      '"\'=cmd@example.com","2026-11-07T09:00:00.000Z"\r\n' +
      '"b@example.com","2026-11-08T10:00:00.000Z"\r\n' +
      '"q""uote@example.com","2026-11-09T09:00:00.000Z"\r\n'
  )
  assert.equal(toCsv([]), 'email,joined_at\r\n')
})
