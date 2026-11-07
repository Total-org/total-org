// GitHub lookups: `npm test` (node --test). A token GitHub refuses must never hide the releases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { githubFetch } from './release.ts'

type Call = { url: string; auth: string | undefined }

function fake(statuses: number[]) {
  const calls: Call[] = []
  const impl = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, auth: (init.headers as Record<string, string>).Authorization })
    return new Response(null, { status: statuses[calls.length - 1] })
  }
  return { calls, impl }
}

test('a refused token (401 / 403 / 404) is retried once without it', async () => {
  for (const status of [401, 403, 404]) {
    const f = fake([status, 200])
    const res = await githubFetch('https://api.github.com/x', {}, undefined, `bad-${status}`, f.impl)
    assert.equal(res.status, 200, String(status))
    assert.deepEqual(f.calls.map((c) => c.auth), [`Bearer bad-${status}`, undefined])
  }
})

test('a good token, or no token, asks once', async () => {
  const ok = fake([200])
  assert.equal((await githubFetch('https://api.github.com/x', {}, undefined, 'good', ok.impl)).status, 200)
  assert.deepEqual(ok.calls.map((c) => c.auth), ['Bearer good'])
  const none = fake([404])
  assert.equal((await githubFetch('https://api.github.com/x', {}, undefined, undefined, none.impl)).status, 404)
  assert.deepEqual(none.calls.map((c) => c.auth), [undefined])
})

test('other failures (rate limit 429, server 500) are not retried', async () => {
  for (const status of [429, 500]) {
    const f = fake([status])
    assert.equal((await githubFetch('https://api.github.com/x', {}, undefined, 'tok', f.impl)).status, status)
    assert.equal(f.calls.length, 1)
  }
})

test('a token refused once is not sent again; one refused where the public lookup also fails is kept', async () => {
  const first = fake([401, 200, 200])
  await githubFetch('https://api.github.com/x', {}, undefined, 'stale', first.impl)
  await githubFetch('https://api.github.com/x', {}, undefined, 'stale', first.impl)
  assert.deepEqual(first.calls.map((c) => c.auth), ['Bearer stale', undefined, undefined])
  const missing = fake([404, 404, 200])
  await githubFetch('https://api.github.com/none', {}, undefined, 'kept', missing.impl)
  await githubFetch('https://api.github.com/x', {}, undefined, 'kept', missing.impl)
  assert.deepEqual(missing.calls.map((c) => c.auth), ['Bearer kept', undefined, 'Bearer kept'])
})
