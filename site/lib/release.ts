/**
 * Release lookup for the download button, version badge and the app's update check.
 * The repo is public; GITHUB_TOKEN (optional, Vercel env) only raises the API rate limits.
 * A token GitHub refuses (expired, or scoped to the old IrminFlow/total repo) must never
 * hide the releases: those lookups are retried without it (githubFetch).
 */
export const GITHUB_REPO = process.env.GITHUB_REPO ?? 'Total-org/total-org'

export const RELEASES_PAGE = `https://github.com/${GITHUB_REPO}/releases/latest`

const TOKEN = process.env.GITHUB_TOKEN

export function githubHeaders(accept = 'application/vnd.github+json', token: string | undefined = TOKEN): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' }
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

type FetchInit = RequestInit & { next?: { revalidate?: number } }
type FetchImpl = (url: string, init: FetchInit) => Promise<Response>

/** Statuses GitHub gives a token it won't honour for this repo (bad / expired / wrong scope). */
const TOKEN_REFUSED = new Set([401, 403, 404])

/** Tokens GitHub refused once — not sent again for the life of this instance (no failing login per request). */
const refusedTokens = new Set<string>()

/**
 * GET from the GitHub API with the token when there is one; when GitHub refuses that token
 * (401 / 403 / 404), ask again without it — the repo and its releases are public.
 */
export async function githubFetch(url: string, init: FetchInit = {}, accept?: string, token: string | undefined = TOKEN, fetchImpl: FetchImpl = fetch): Promise<Response> {
  const useToken = token && !refusedTokens.has(token) ? token : undefined
  const res = await fetchImpl(url, { ...init, headers: githubHeaders(accept, useToken) })
  if (!useToken || !TOKEN_REFUSED.has(res.status)) return res
  const retry = await fetchImpl(url, { ...init, headers: githubHeaders(accept, undefined) })
  // Only a token that was refused while the public lookup worked is remembered (a real 404 isn't the token's fault).
  if (retry.ok || (retry.status >= 300 && retry.status < 400)) refusedTokens.add(useToken)
  return retry
}

export type Platform = 'mac' | 'win'

interface AssetRef {
  id: number
  /** Direct asset URL — only downloadable without auth when the repo is public. */
  publicUrl: string
}

export interface ReleaseInfo {
  version: string
  htmlUrl: string
  assets: Partial<Record<Platform, AssetRef>>
}

/** Latest release, or null when the repo has no releases yet / token is missing on a private repo. */
export async function latestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await githubFetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, { next: { revalidate: 300 } })
    if (!res.ok) return null
    const data = (await res.json()) as {
      tag_name?: string
      html_url?: string
      assets?: { id: number; name: string; browser_download_url: string }[]
    }
    if (!data.tag_name) return null
    const find = (suffix: string): AssetRef | undefined => {
      const asset = data.assets?.find((a) => a.name.endsWith(suffix))
      return asset ? { id: asset.id, publicUrl: asset.browser_download_url } : undefined
    }
    return {
      version: data.tag_name.replace(/^v/, ''),
      htmlUrl: data.html_url ?? RELEASES_PAGE,
      assets: { mac: find('.dmg'), win: find('.exe') }
    }
  } catch {
    return null
  }
}

export interface ReleaseNote {
  version: string
  name: string
  date: string
  body: string
}

/** Published (non-draft, non-prerelease) releases, newest first. Empty on any failure. */
export async function listReleases(): Promise<ReleaseNote[]> {
  try {
    const res = await githubFetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=20`, { next: { revalidate: 300 } })
    if (!res.ok) return []
    const data = (await res.json()) as {
      tag_name?: string
      name?: string | null
      published_at?: string | null
      body?: string | null
      draft?: boolean
      prerelease?: boolean
    }[]
    return data
      .filter((r) => !r.draft && !r.prerelease && r.tag_name)
      .map((r) => ({
        version: (r.tag_name as string).replace(/^v/, ''),
        name: r.name ?? (r.tag_name as string),
        date: r.published_at ?? '',
        body: r.body ?? ''
      }))
  } catch {
    return []
  }
}

/**
 * A URL the browser can actually download from. For a private repo, asking the API
 * for the asset as octet-stream returns a redirect to a short-lived unauthenticated
 * URL — we hand that to the visitor.
 */
export async function resolveDownloadUrl(release: ReleaseInfo, platform: Platform): Promise<string> {
  const asset = release.assets[platform]
  if (!asset) return release.htmlUrl
  if (!TOKEN) return asset.publicUrl
  try {
    const res = await githubFetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${asset.id}`, { redirect: 'manual', cache: 'no-store' }, 'application/octet-stream')
    const location = res.headers.get('location')
    if (location) return location
  } catch {
    // fall through
  }
  return asset.publicUrl
}
