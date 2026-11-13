// Audit A4 (SEC-5): the release script signs, the app verifies — the two sides agree, and every
// tampering is refused. Plain vitest (node crypto only).
import { describe, expect, it } from 'vitest'
import { generateKeyPairSync, createHash } from 'crypto'
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
// @ts-expect-error — plain .mjs release script (no types)
import { buildManifest, signManifest, checkManifest, releaseKeys as scriptKeys, ASSET_NAME as SCRIPT_ASSET_NAME, MAX_ASSETS as SCRIPT_MAX_ASSETS } from '../../scripts/release/manifest.mjs'
import { ASSET_NAME, MAX_ASSETS, assetWithHash, engineAssetNames, installerFor, releaseAssetUrl, RELEASE_KEYS, sha512File, verifyManifest, type ReleaseKey } from './releaseManifest'

function testKey(id = 'test-key'): { pem: string; keys: ReleaseKey[] } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    pem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    keys: [{ id, spki: publicKey.export({ type: 'spki', format: 'der' }).toString('base64') }]
  }
}

const V = '0.13.0'
const FILES = [
  `Total-${V}-arm64.dmg`,
  `Total-${V}-arm64-mac.zip`,
  `Total-Setup-${V}.exe`,
  'latest.yml',
  'latest-mac.yml'
].map((name) => ({ name, bytes: Buffer.from(`bytes of ${name}`) }))

const sha512 = (b: Buffer): string => createHash('sha512').update(b).digest('hex')

describe('release manifest', () => {
  it('the pinned key is the same for the app and the release script', () => {
    expect(RELEASE_KEYS.length).toBeGreaterThan(0)
    expect(scriptKeys()).toEqual(RELEASE_KEYS)
    for (const k of RELEASE_KEYS) expect(Buffer.from(k.spki, 'base64')).toHaveLength(44) // Ed25519 SPKI
  })

  it('what the script signs, the app verifies (and the script\'s own check agrees)', () => {
    const { pem, keys } = testKey()
    const text = signManifest(buildManifest(V, FILES), pem, keys)
    const check = verifyManifest(text, `v${V}`, keys)
    expect(check.ok).toBe(true)
    if (!check.ok) return
    expect(check.manifest.version).toBe(V)
    expect(check.manifest.assets.map((a) => a.name)).toEqual([...FILES.map((f) => f.name)].sort())
    expect(checkManifest(text, V, keys).ok).toBe(true)
    const exe = FILES.find((f) => f.name.endsWith('.exe'))!
    expect(assetWithHash(check.manifest, sha512(exe.bytes))?.name).toBe(exe.name)
    expect(assetWithHash(check.manifest, 'f'.repeat(128))).toBeNull()
    expect(installerFor(check.manifest, 'darwin')?.name).toBe(`Total-${V}-arm64.dmg`)
    expect(installerFor(check.manifest, 'win32')?.name).toBe(`Total-Setup-${V}.exe`)
    expect(installerFor(check.manifest, 'linux')).toBeNull()
    expect(installerFor(check.manifest, 'darwin', 'arm64')?.name).toBe(`Total-${V}-arm64.dmg`)
    // SEC2-5: a hash match counts only for an asset this platform installs.
    const zip = FILES.find((f) => f.name.endsWith('-mac.zip'))!
    expect(assetWithHash(check.manifest, sha512(exe.bytes), engineAssetNames(V, 'win32', 'x64'))?.name).toBe(exe.name)
    expect(assetWithHash(check.manifest, sha512(zip.bytes), engineAssetNames(V, 'win32', 'x64'))).toBeNull()
    expect(assetWithHash(check.manifest, sha512(zip.bytes), engineAssetNames(V, 'darwin', 'arm64'))?.name).toBe(zip.name)
    expect(assetWithHash(check.manifest, sha512(exe.bytes), engineAssetNames(V, 'darwin', 'arm64'))).toBeNull()
    const yml = FILES.find((f) => f.name === 'latest.yml')!
    expect(assetWithHash(check.manifest, sha512(yml.bytes), engineAssetNames(V, 'darwin', 'arm64'))).toBeNull()
    expect(engineAssetNames(`v${V}`, 'darwin', 'x64')).toEqual([`Total-${V}-x64-mac.zip`, `Total-${V}-mac.zip`])
    expect(engineAssetNames(V, 'linux', 'x64')).toEqual([])
  })

  it('installerFor prefers the DMG built for this Mac', () => {
    const asset = (name: string) => ({ name, size: 1, sha256: '0'.repeat(64), sha512: '0'.repeat(128) })
    const m = { version: V, assets: [asset(`Total-${V}-arm64.dmg`), asset(`Total-${V}.dmg`)] }
    expect(installerFor(m, 'darwin', 'x64')?.name).toBe(`Total-${V}.dmg`)
    expect(installerFor(m, 'darwin', 'arm64')?.name).toBe(`Total-${V}-arm64.dmg`)
    expect(installerFor({ version: V, assets: [asset(`Total-${V}-arm64.dmg`)] }, 'darwin', 'x64')?.name).toBe(`Total-${V}-arm64.dmg`) // as before
  })

  it('refuses a key the app does not pin, a changed asset, another version and a bad signature', () => {
    const { pem, keys } = testKey()
    const other = testKey()
    const text = signManifest(buildManifest(V, FILES), pem, keys)
    // Signed with an unpinned key.
    expect(verifyManifest(text, V, other.keys).ok).toBe(false)
    // An asset hash swapped inside the signed text.
    const file = JSON.parse(text) as { keyId: string; manifest: string; signature: string }
    const m = JSON.parse(file.manifest) as { assets: { sha512: string }[] }
    m.assets[0]!.sha512 = 'e'.repeat(128)
    expect(verifyManifest(JSON.stringify({ ...file, manifest: JSON.stringify(m) }), V, keys)).toEqual({ ok: false, reason: 'bad signature' })
    // A genuine manifest of another release replayed for a newer version.
    expect(verifyManifest(text, '0.14.0', keys).ok).toBe(false)
    // Garbage / truncated signature / not JSON.
    expect(verifyManifest(JSON.stringify({ ...file, signature: 'AAAA' }), V, keys).ok).toBe(false)
    expect(verifyManifest('not json', V, keys).ok).toBe(false)
    expect(verifyManifest('', V, keys).ok).toBe(false)
    // The script refuses to sign with a key the app would not accept.
    expect(() => signManifest(buildManifest(V, FILES), other.pem, keys)).toThrow(/does not match/)
  })

  it('the script check wants every release asset listed', () => {
    const { pem, keys } = testKey()
    const text = signManifest(buildManifest(V, FILES.filter((f) => !f.name.endsWith('.exe'))), pem, keys)
    expect(checkManifest(text, V, keys)).toMatchObject({ ok: false, reason: expect.stringMatching(/Windows installer/) })
  })

  it('the signer refuses exactly what the app would refuse (never a signed release nobody is offered)', () => {
    expect(SCRIPT_ASSET_NAME.source).toBe(ASSET_NAME.source)
    expect(SCRIPT_MAX_ASSETS).toBe(MAX_ASSETS)
    const { pem, keys } = testKey()
    for (const name of ['Total-1.0.0+build.zip', 'Total Setup 1.0.0.exe', 'notes (draft).md', 'टोटल.zip'])
      expect(() => buildManifest(V, [...FILES, { name, bytes: Buffer.from('x') }]), name).toThrow(/would refuse/)
    const many = Array.from({ length: MAX_ASSETS + 1 }, (_, i) => ({ name: `f${i}.bin`, bytes: Buffer.from([i % 256]) }))
    expect(() => buildManifest(V, many)).toThrow(/1–200/)
    // Whatever the signer does accept, the app verifies.
    const ok = [...FILES, { name: 'Total-1.0.0_build-2.zip', bytes: Buffer.from('y') }]
    expect(verifyManifest(signManifest(buildManifest(V, ok), pem, keys), V, keys).ok).toBe(true)
  })

  it('a manifest never lists itself', () => {
    const text = buildManifest(V, [...FILES, { name: 'total-manifest.json', bytes: Buffer.from('x') }])
    expect((JSON.parse(text) as { assets: { name: string }[] }).assets.map((a) => a.name)).not.toContain('total-manifest.json')
  })

  it('hashes a file streamed, as the downloaded installer is checked', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'total-manifest-'))
    const bytes = Buffer.alloc(3 * 1024 * 1024, 7)
    writeFileSync(join(dir, 'setup.exe'), bytes)
    expect(await sha512File(join(dir, 'setup.exe'))).toBe(sha512(bytes))
  })

  it('downloads come from this repo\'s GitHub release, never the site', () => {
    expect(releaseAssetUrl('Total-org/total-org', 'v0.13.0', 'total-manifest.json')).toBe(
      'https://github.com/Total-org/total-org/releases/download/v0.13.0/total-manifest.json'
    )
  })
})
