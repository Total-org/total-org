// WP 7.2 hardening: the only things the renderer may ask the OS to open outside the app (a
// `window.open` / target=_blank reaches main's setWindowOpenHandler, which opens nothing else):
//   - the help articles' pages (the GST portal / CBIC — helpLinks.ts, exact hosts);
//   - an e-mail draft (`mailto:` — statements and reminders, the support link);
//   - a WhatsApp chat (`https://wa.me/<number>?text=…` — People → Remind, shared/simple/people.ts).
// Everything else is refused (and logged by main). Pure; tested in externalLinks.test.ts.
import { allowedHelpUrl } from './helpLinks'
import { GITHUB_REPO, SITE_URL } from './product'

/** The normalised URL to open, or null when it is not one of the above. */
export function allowedExternalUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length > 8192) return null
  const help = allowedHelpUrl(url)
  if (help) return help
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol === 'mailto:') return u.href
  // wa.me: a chat with a number (digits only) or the bare share page — never another path on it.
  if (u.protocol === 'https:' && u.hostname === 'wa.me' && !u.username && !u.password && (!u.port || u.port === '443') && /^\/(\d{1,15})?$/.test(u.pathname) && !u.hash) return u.href
  return null
}

/** The marketing site's hosts (SITE_URL + the old domain old installs still ask — CLAUDE.md "Site deploy"). */
const UPDATE_SITE_HOSTS = new Set([new URL(SITE_URL).hostname, `www.${new URL(SITE_URL).hostname}`, 'devjindal.tech'])

/** Audit A4 (SEC-10): the only pages the updater may hand to the OS — https on the site's hosts, or
 *  this repo's GitHub releases (the release list, a release, one of its files). Anything else (a
 *  `file:` / `smb:` / `search-ms:` URL, another host or repo) is null and the caller opens the
 *  release list instead. */
export function allowedUpdateUrl(url: string): string | null {
  if (typeof url !== 'string' || url.length > 2048) return null
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null
  if (UPDATE_SITE_HOSTS.has(u.hostname)) return u.href
  const releases = `/${GITHUB_REPO}/releases`.toLowerCase()
  const path = u.pathname.toLowerCase()
  if (u.hostname === 'github.com' && (path === releases || path.startsWith(`${releases}/`)) && !path.includes('/../')) return u.href
  return null
}
