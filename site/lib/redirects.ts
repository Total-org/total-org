// Canonical host (owner, 8 Nov 2026: the site moved from devjindal.tech to irminflow.com).
//   - www.irminflow.com → irminflow.com, every path (308).
//   - devjindal.tech (and www.) pages → the same path on irminflow.com (308), EXCEPT /api/*:
//     every installed 0.x app asks https://devjindal.tech/api/latest (and opens /api/download)
//     by its hard-coded SITE_URL, so those keep answering on the old host directly — never a
//     redirect, even though the app's fetch would follow one.
// Used by next.config.ts; tested in redirects.test.ts (node --test).

export const CANONICAL_HOST = 'irminflow.com'
export const OLD_HOSTS = ['devjindal.tech', 'www.devjindal.tech'] as const

/** A path segment pattern (path-to-regexp) for "anything except api or api/…" — the empty path (/) included. */
export const NOT_API = '(?!api(?:/|$)).*'

type Redirect = { source: string; has: { type: 'host'; value: string }[]; destination: string; permanent: true }

const escapeHost = (h: string): string => h.replace(/\./g, '\\.')

export function siteRedirects(): Redirect[] {
  const to = `https://${CANONICAL_HOST}`
  return [
    { source: '/:path*', has: [{ type: 'host', value: escapeHost(`www.${CANONICAL_HOST}`) }], destination: `${to}/:path*`, permanent: true },
    ...OLD_HOSTS.flatMap((host): Redirect[] => [
      { source: '/', has: [{ type: 'host', value: escapeHost(host) }], destination: `${to}/`, permanent: true },
      { source: `/:path(${NOT_API})`, has: [{ type: 'host', value: escapeHost(host) }], destination: `${to}/:path`, permanent: true }
    ])
  ]
}
