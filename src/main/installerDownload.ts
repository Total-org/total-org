/**
 * Audit 2 SEC2-2: the installer a person updates with by hand (macOS always — builds are unsigned, so
 * electron-updater can't install —, Windows when the engine fails) is downloaded HERE, in main, and
 * kept only when its size and SHA-512 equal the signed release manifest's entry (releaseManifest.ts).
 * Only then is the file shown to the user; a file that doesn't match is deleted and never opened, and
 * the browser is never sent to download unchecked bytes.
 *
 * Pure Node (fs / crypto / stream); the fetch is injected so the network stays in updater.ts
 * (ai/networkBoundary.test.ts) and the tests use in-memory responses.
 */
import { createHash } from 'crypto'
import { createWriteStream, existsSync, rmSync } from 'fs'
import { basename, join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { ReadableStream as WebReadableStream } from 'stream/web'
import { renameReplacing } from './fsRetry'
import type { ManifestAsset } from './releaseManifest'

/** The downloaded bytes are not the signed installer (size or SHA-512 differ, or too many bytes). */
export class InstallerMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InstallerMismatch'
  }
}

export interface DownloadResponse {
  ok: boolean
  status: number
  body: unknown
}

export interface DownloadOptions {
  fetchImpl: (url: string) => Promise<DownloadResponse>
  url: string
  /** The installer's entry in the VERIFIED manifest. */
  asset: ManifestAsset
  /** The folder the checked file is left in (the user's Downloads). */
  dir: string
}

/** A name that is safe to join onto `dir` (the manifest's ASSET_NAME already refuses separators). */
function safeName(name: string): string {
  if (basename(name) !== name || name.startsWith('.') || !/^[\w.-]+$/.test(name)) throw new InstallerMismatch(`unsafe file name ${name}`)
  return name
}

/** Download `url` into `dir/<asset.name>`; resolves with the path only when the file IS the asset. */
export async function downloadVerifiedInstaller(o: DownloadOptions): Promise<string> {
  const name = safeName(o.asset.name)
  const final = join(o.dir, name)
  const temp = join(o.dir, `${name}.download`)
  const res = await o.fetchImpl(o.url)
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`)
  const hash = createHash('sha512')
  let bytes = 0
  const check = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length
      // Never write more than the signed size (a swapped or endless body stops here).
      if (bytes > o.asset.size) return done(new InstallerMismatch(`more than ${o.asset.size} bytes`))
      hash.update(chunk)
      done(null, chunk)
    }
  })
  try {
    await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), check, createWriteStream(temp))
    if (bytes !== o.asset.size) throw new InstallerMismatch(`${bytes} bytes, signed ${o.asset.size}`)
    const got = hash.digest('hex')
    if (got !== o.asset.sha512) throw new InstallerMismatch('SHA-512 differs from the signed manifest')
    renameReplacing(temp, final)
    return final
  } catch (err) {
    if (existsSync(temp)) rmSync(temp, { force: true })
    throw err
  }
}
