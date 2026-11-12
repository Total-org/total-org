#!/usr/bin/env node
// Audit A4 (SEC-5): the signed release manifest — the app checks it before it offers an update.
//
//   node scripts/release/manifest.mjs sign <assets dir> <version> <out file>
//       hashes every file in <assets dir> (SHA-256 + SHA-512, size) and signs the list with the
//       Ed25519 private key in $RELEASE_MANIFEST_KEY (PEM, PKCS#8). Refuses without the key.
//   node scripts/release/manifest.mjs check <manifest file> <version> [<assets dir>]
//       verifies the signature against the public keys the app pins (src/main/releaseKeys.json),
//       the version, that every required asset is listed and (with a dir) that every file matches.
//
// The file is JSON { keyId, manifest, signature }: `manifest` is the signed JSON text itself (no
// re-serialising), the signature covers MANIFEST_CONTEXT + that text. The app's side is
// src/main/releaseManifest.ts (round trip tested in releaseManifest.test.ts).
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { missingAssets } from './lib.mjs'

export const MANIFEST_ASSET = 'total-manifest.json'
export const MANIFEST_CONTEXT = 'total-release-manifest:v1\n'

const here = dirname(fileURLToPath(import.meta.url))
/** The pinned public keys, read when first needed: gate.mjs imports this file in jobs whose sparse
 *  checkout holds only scripts/release (the verify job also checks out src/main for the keys). */
export function releaseKeys() {
  return JSON.parse(readFileSync(join(here, '..', '..', 'src', 'main', 'releaseKeys.json'), 'utf8')).keys
}

const hashOf = (bytes, algo) => createHash(algo).update(bytes).digest('hex')

/** The manifest text for `version` over [{ name, bytes }] (sorted by name). */
export function buildManifest(version, files, created = new Date().toISOString()) {
  const v = String(version).replace(/^v/, '')
  const assets = files
    .filter((f) => f.name !== MANIFEST_ASSET)
    .map((f) => ({ name: f.name, size: f.bytes.length, sha256: hashOf(f.bytes, 'sha256'), sha512: hashOf(f.bytes, 'sha512') }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return JSON.stringify({ format: 1, product: 'Total', version: v, tag: `v${v}`, created, assets })
}

/** The keyId of a public key (PEM / KeyObject) in the pinned keys, or null. */
function keyIdOf(publicKey, keys) {
  const spki = createPublicKey(publicKey).export({ type: 'spki', format: 'der' }).toString('base64')
  return keys.find((k) => k.spki === spki)?.id ?? null
}

/** Sign the manifest text: the file's JSON. The key must be one the app pins. */
export function signManifest(manifestText, privateKeyPem, keys = releaseKeys()) {
  const key = createPrivateKey(privateKeyPem)
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('RELEASE_MANIFEST_KEY is not an Ed25519 key')
  const keyId = keyIdOf(key, keys)
  if (!keyId) throw new Error('RELEASE_MANIFEST_KEY does not match any public key in src/main/releaseKeys.json')
  const signature = sign(null, Buffer.from(MANIFEST_CONTEXT + manifestText, 'utf8'), key).toString('base64')
  return JSON.stringify({ keyId, manifest: manifestText, signature }, null, 2) + '\n'
}

/** Check a signed manifest file's text: { ok, reason, manifest }. */
export function checkManifest(fileText, version, keys = releaseKeys()) {
  let file
  try {
    file = JSON.parse(fileText)
  } catch {
    return { ok: false, reason: 'the manifest is not JSON' }
  }
  const key = keys.find((k) => k.id === file?.keyId)
  if (!key) return { ok: false, reason: `unknown signing key ${String(file?.keyId)}` }
  if (typeof file.manifest !== 'string' || typeof file.signature !== 'string') return { ok: false, reason: 'the manifest file is incomplete' }
  const publicKey = createPublicKey({ key: Buffer.from(key.spki, 'base64'), format: 'der', type: 'spki' })
  if (!verify(null, Buffer.from(MANIFEST_CONTEXT + file.manifest, 'utf8'), publicKey, Buffer.from(file.signature, 'base64')))
    return { ok: false, reason: 'the signature does not verify' }
  const manifest = JSON.parse(file.manifest)
  const v = String(version).replace(/^v/, '')
  if (manifest.format !== 1 || manifest.version !== v) return { ok: false, reason: `the manifest is for ${String(manifest.version)}, not ${v}` }
  const missing = missingAssets(v, manifest.assets.map((a) => a.name))
  if (missing.length) return { ok: false, reason: `the manifest does not list ${missing.join(', ')}` }
  return { ok: true, reason: `signed by ${key.id}`, manifest }
}

const readDir = (dir) =>
  readdirSync(dir)
    .filter((n) => statSync(join(dir, n)).isFile())
    .map((name) => ({ name, bytes: readFileSync(join(dir, name)) }))

function main(argv) {
  const [cmd, a, version, out] = argv
  if (cmd === 'sign') {
    const pem = process.env.RELEASE_MANIFEST_KEY
    if (!pem) throw new Error('RELEASE_MANIFEST_KEY is not set — a release is never published without its signed manifest')
    const files = readDir(a)
    const text = signManifest(buildManifest(version, files), pem)
    const check = checkManifest(text, version)
    if (!check.ok) throw new Error(`the manifest just signed does not check: ${check.reason}`)
    writeFileSync(out, text)
    console.log(`${basename(out)}: ${files.length} assets, ${check.reason}`)
    return
  }
  if (cmd === 'check') {
    const check = checkManifest(readFileSync(a, 'utf8'), version)
    if (!check.ok) throw new Error(check.reason)
    if (out) {
      for (const f of readDir(out)) {
        if (f.name === MANIFEST_ASSET) continue
        const listed = check.manifest.assets.find((x) => x.name === f.name)
        if (!listed || listed.sha512 !== hashOf(f.bytes, 'sha512')) throw new Error(`${f.name} does not match the manifest`)
      }
    }
    console.log(`manifest OK: ${check.reason}`)
    return
  }
  throw new Error('usage: manifest.mjs sign <dir> <version> <out> | check <file> <version> [<dir>]')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main(process.argv.slice(2))
  } catch (err) {
    console.error(String(err instanceof Error ? err.message : err))
    process.exit(1)
  }
}
