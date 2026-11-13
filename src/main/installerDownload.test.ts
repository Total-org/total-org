// Audit 2 SEC2-2: the hand-download installer is kept only when it IS the signed asset. Plain vitest
// (in-memory responses, a temp folder — no network).
import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DownloadStalled, downloadVerifiedInstaller, InstallerMismatch } from './installerDownload'
import type { ManifestAsset } from './releaseManifest'

const GOOD = Buffer.from('the signed installer bytes '.repeat(5000))
const assetOf = (bytes: Buffer, name = 'Total-0.13.0-arm64.dmg'): ManifestAsset => ({
  name,
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sha512: createHash('sha512').update(bytes).digest('hex')
})
const respond = (body: Buffer | null, status = 200) => async (_url: string) => new Response(body ? new Uint8Array(body) : null, { status })
const dir = (): string => mkdtempSync(join(tmpdir(), 'total-installer-'))

describe('downloadVerifiedInstaller', () => {
  it('keeps the file under the asset name when size + SHA-512 match, with no temp file left', async () => {
    const d = dir()
    const path = await downloadVerifiedInstaller({ fetchImpl: respond(GOOD), url: 'https://x/a', asset: assetOf(GOOD), dir: d })
    expect(path).toBe(join(d, 'Total-0.13.0-arm64.dmg'))
    expect(readFileSync(path).equals(GOOD)).toBe(true)
    expect(readdirSync(d)).toEqual(['Total-0.13.0-arm64.dmg'])
  })

  it('a swapped file of the same size is refused and deleted (nothing left to open)', async () => {
    const d = dir()
    const evil = Buffer.from(GOOD)
    evil[100] = evil[100]! ^ 1
    await expect(downloadVerifiedInstaller({ fetchImpl: respond(evil), url: 'https://x/a', asset: assetOf(GOOD), dir: d })).rejects.toBeInstanceOf(InstallerMismatch)
    expect(readdirSync(d)).toEqual([])
  })

  it('a shorter or a longer body is refused (a longer one stops at the signed size)', async () => {
    const d = dir()
    const asset = assetOf(GOOD)
    await expect(downloadVerifiedInstaller({ fetchImpl: respond(GOOD.subarray(1)), url: 'u', asset, dir: d })).rejects.toBeInstanceOf(InstallerMismatch)
    await expect(downloadVerifiedInstaller({ fetchImpl: respond(Buffer.concat([GOOD, Buffer.from('x')])), url: 'u', asset, dir: d })).rejects.toBeInstanceOf(
      InstallerMismatch
    )
    expect(readdirSync(d)).toEqual([])
  })

  it('a refused download leaves an earlier file of that name alone; a good one replaces it', async () => {
    const d = dir()
    const final = join(d, 'Total-0.13.0-arm64.dmg')
    writeFileSync(final, 'older')
    await expect(downloadVerifiedInstaller({ fetchImpl: respond(Buffer.from('bad')), url: 'u', asset: assetOf(GOOD), dir: d })).rejects.toThrow()
    expect(readFileSync(final, 'utf8')).toBe('older')
    await downloadVerifiedInstaller({ fetchImpl: respond(GOOD), url: 'u', asset: assetOf(GOOD), dir: d })
    expect(readFileSync(final).equals(GOOD)).toBe(true)
  })

  it('an HTTP error is a plain error (not a mismatch) and writes nothing', async () => {
    const d = dir()
    const p = downloadVerifiedInstaller({ fetchImpl: respond(Buffer.from('nope'), 404), url: 'u', asset: assetOf(GOOD), dir: d })
    await expect(p).rejects.toThrow(/HTTP 404/)
    await expect(p).rejects.not.toBeInstanceOf(InstallerMismatch)
    expect(readdirSync(d)).toEqual([])
  })

  it('a body that stops sending is given up after the idle time, with no file left (review of #270)', async () => {
    const d = dir()
    const stalled = async (_url: string, signal: AbortSignal) => {
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array(GOOD.subarray(0, 1000)))
          signal.addEventListener('abort', () => c.error(signal.reason))
        }
      })
      return new Response(body)
    }
    await expect(downloadVerifiedInstaller({ fetchImpl: stalled, url: 'u', asset: assetOf(GOOD), dir: d, idleMs: 50 })).rejects.toBeInstanceOf(DownloadStalled)
    expect(readdirSync(d)).toEqual([])
    // A request that never answers is given up too.
    const silent = (_url: string, signal: AbortSignal) => new Promise<Response>((_r, reject) => signal.addEventListener('abort', () => reject(signal.reason)))
    await expect(downloadVerifiedInstaller({ fetchImpl: silent, url: 'u', asset: assetOf(GOOD), dir: d, idleMs: 50 })).rejects.toBeInstanceOf(DownloadStalled)
  })

  it('a slow body that keeps sending is not cut off', async () => {
    const d = dir()
    const slow = async () => {
      let i = 0
      const body = new ReadableStream<Uint8Array>({
        async pull(c) {
          await new Promise((r) => setTimeout(r, 20))
          const part = GOOD.subarray(i, i + 30000)
          i += 30000
          if (part.length) c.enqueue(new Uint8Array(part))
          else c.close()
        }
      })
      return new Response(body)
    }
    const p = await downloadVerifiedInstaller({ fetchImpl: slow, url: 'u', asset: assetOf(GOOD), dir: d, idleMs: 60 })
    expect(readFileSync(p).equals(GOOD)).toBe(true)
  })

  it('never writes outside the folder (a name with a path or a leading dot is refused)', async () => {
    const d = dir()
    for (const name of ['../Total.dmg', '..', '.hidden.dmg']) {
      await expect(downloadVerifiedInstaller({ fetchImpl: respond(GOOD), url: 'u', asset: assetOf(GOOD, name), dir: d })).rejects.toBeInstanceOf(InstallerMismatch)
    }
    expect(readdirSync(d)).toEqual([])
    expect(existsSync(join(d, '..', 'Total.dmg'))).toBe(false)
  })
})
