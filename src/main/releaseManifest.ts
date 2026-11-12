/**
 * Audit A4 (SEC-5): the signed release manifest the updater checks before it offers an update.
 *
 * Builds are not notarised yet, so a release on GitHub (or the site's /api/latest) is not proof by
 * itself. release.yml hashes every asset of a release and signs the list with an Ed25519 key that
 * lives only in a GitHub secret; the public key is pinned here (releaseKeys.json). The app offers a
 * version only when `total-manifest.json` of THAT release verifies against a pinned key and names
 * that exact version, and installs an engine download only when the downloaded file's SHA-512 is in
 * it. The signer is scripts/release/manifest.mjs (round trip in releaseManifest.test.ts).
 *
 * Pure Node crypto / fs — no Electron — so it is plain-vitest testable.
 */
import { createHash, createPublicKey, verify } from 'crypto'
import { createReadStream } from 'fs'
import releaseKeys from './releaseKeys.json'

export const MANIFEST_ASSET = 'total-manifest.json'
export const MANIFEST_CONTEXT = 'total-release-manifest:v1\n'

export interface ReleaseKey {
  id: string
  /** base64 DER SubjectPublicKeyInfo of an Ed25519 key */
  spki: string
}

export const RELEASE_KEYS: readonly ReleaseKey[] = releaseKeys.keys

export interface ManifestAsset {
  name: string
  size: number
  sha256: string
  sha512: string
}

export interface ReleaseManifest {
  version: string
  assets: ManifestAsset[]
}

export type ManifestCheck = { ok: true; manifest: ReleaseManifest; keyId: string } | { ok: false; reason: string }

const HEX = (len: number): RegExp => new RegExp(`^[0-9a-f]{${len}}$`)
const MAX_MANIFEST_BYTES = 256 * 1024

function readAssets(raw: unknown): ManifestAsset[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null
  const out: ManifestAsset[] = []
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a.name !== 'string' || !/^[\w.-]{1,200}$/.test(a.name)) return null
    if (!Number.isSafeInteger(a.size) || (a.size as number) < 0) return null
    if (typeof a.sha256 !== 'string' || !HEX(64).test(a.sha256)) return null
    if (typeof a.sha512 !== 'string' || !HEX(128).test(a.sha512)) return null
    out.push({ name: a.name, size: a.size as number, sha256: a.sha256, sha512: a.sha512 })
  }
  return out
}

/** Verify a `total-manifest.json` text for `version` (a leading "v" is ignored). Never throws. */
export function verifyManifest(fileText: string, version: string, keys: readonly ReleaseKey[] = RELEASE_KEYS): ManifestCheck {
  try {
    if (typeof fileText !== 'string' || fileText.length > MAX_MANIFEST_BYTES) return { ok: false, reason: 'manifest too large' }
    const file = JSON.parse(fileText) as { keyId?: unknown; manifest?: unknown; signature?: unknown }
    const key = keys.find((k) => k.id === file.keyId)
    if (!key) return { ok: false, reason: 'unknown signing key' }
    if (typeof file.manifest !== 'string' || typeof file.signature !== 'string') return { ok: false, reason: 'incomplete manifest' }
    const publicKey = createPublicKey({ key: Buffer.from(key.spki, 'base64'), format: 'der', type: 'spki' })
    const signed = Buffer.from(MANIFEST_CONTEXT + file.manifest, 'utf8')
    if (!verify(null, signed, publicKey, Buffer.from(file.signature, 'base64'))) return { ok: false, reason: 'bad signature' }
    const m = JSON.parse(file.manifest) as { format?: unknown; version?: unknown; assets?: unknown }
    const want = version.replace(/^v/, '')
    if (m.format !== 1) return { ok: false, reason: 'unknown manifest format' }
    if (m.version !== want) return { ok: false, reason: `manifest is for ${String(m.version)}, not ${want}` }
    const assets = readAssets(m.assets)
    if (!assets) return { ok: false, reason: 'malformed asset list' }
    return { ok: true, manifest: { version: want, assets }, keyId: key.id }
  } catch (err) {
    return { ok: false, reason: `unreadable manifest: ${String(err instanceof Error ? err.message : err)}` }
  }
}

/** Where a release's manifest / asset is downloaded from (GitHub, never the site). */
export const releaseAssetUrl = (repo: string, version: string, name: string): string =>
  `https://github.com/${repo}/releases/download/v${encodeURIComponent(version.replace(/^v/, ''))}/${encodeURIComponent(name)}`

/** The installer a person downloads by hand on this platform (macOS → the DMG, Windows → the setup exe). */
export function installerFor(manifest: ReleaseManifest, platform: string): ManifestAsset | null {
  const v = manifest.version
  const want = platform === 'darwin' ? (n: string) => n.startsWith(`Total-${v}`) && n.endsWith('.dmg') : platform === 'win32' ? (n: string) => n === `Total-Setup-${v}.exe` : null
  return want ? (manifest.assets.find((a) => want(a.name)) ?? null) : null
}

/** SHA-512 (hex) of a file, streamed. */
export function sha512File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha512')
    createReadStream(path)
      .on('error', reject)
      .on('data', (chunk) => h.update(chunk))
      .on('end', () => resolve(h.digest('hex')))
  })
}

/** The manifest entry a downloaded file's SHA-512 matches, or null. */
export function assetWithHash(manifest: ReleaseManifest, sha512: string): ManifestAsset | null {
  return manifest.assets.find((a) => a.sha512 === sha512.toLowerCase()) ?? null
}
