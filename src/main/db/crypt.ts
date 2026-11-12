// Pure Node crypto/fs — no Electron, no better-sqlite3 — so this is plain-vitest testable.
//
// File formats — AES-256-GCM with a scrypt-derived key, streamed so multi-GB company databases
// don't need to fit in memory twice:
//   "TOTALBK2" (written since audit A4 / SEC-9): magic(8) | log2 N(1) | r(1) | p(1) | salt(16) |
//              iv(12) | ciphertext | gcmTag(16) — scrypt N = 2^17, r = 8, p = 1 (the company key
//              envelope's cost, keyEnvelope.ts), the whole header is the GCM associated data so
//              a lowered cost fails the tag; the KDF runs off the main thread.
//   "TOTALBK1" (before): magic(8) | salt(16) | iv(12) | ciphertext | gcmTag(16), scrypt N = 2^14 —
//              still read, never written.
import { randomBytes, scrypt, createCipheriv, createDecipheriv, type DecipherGCM } from 'crypto'
import { createReadStream, createWriteStream, openSync, readSync, closeSync, statSync, unlink } from 'fs'

/** The format written today. */
export const MAGIC = Buffer.from('TOTALBK2', 'utf8')
export const MAGIC_V1 = Buffer.from('TOTALBK1', 'utf8')
const SALT_LEN = 16
const IV_LEN = 12
const TAG_LEN = 16
const PARAMS_LEN = 3
const HEADER_LEN_V1 = MAGIC_V1.length + SALT_LEN + IV_LEN
const HEADER_LEN_V2 = MAGIC.length + PARAMS_LEN + SALT_LEN + IV_LEN

export interface BackupKdf {
  /** log2 of scrypt's N */
  logN: number
  r: number
  p: number
}

/** New exports: N = 2^17, r = 8, p = 1 — the OWASP scrypt minimum the key envelope uses. */
export const EXPORT_KDF: BackupKdf = { logN: 17, r: 8, p: 1 }
const V1_KDF: BackupKdf = { logN: 14, r: 8, p: 1 }

const WRONG_PASSPHRASE = 'Wrong passphrase or corrupted file'

/** A cost an import accepts (a forged header can't make scrypt take minutes or gigabytes). */
const kdfInRange = (k: BackupKdf): boolean => k.logN >= 14 && k.logN <= 20 && k.r >= 1 && k.r <= 16 && k.p >= 1 && k.p <= 4

function deriveKey(passphrase: string, salt: Buffer, k: BackupKdf): Promise<Buffer> {
  const N = 2 ** k.logN
  return new Promise((resolve, reject) => {
    // maxmem must exceed 128 * N * r bytes, or scrypt refuses.
    scrypt(passphrase, salt, 32, { N, r: k.r, p: k.p, maxmem: 256 * N * k.r + 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key)))
  })
}

/** Encrypt `srcPath` into `destPath` in the TOTALBK2 format, streaming throughout. `kdf` is for tests. */
export async function encryptFile(srcPath: string, destPath: string, passphrase: string, kdf: BackupKdf = EXPORT_KDF): Promise<void> {
  if (!kdfInRange(kdf)) throw new Error('Unsupported key-derivation cost')
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = await deriveKey(passphrase, salt, kdf)
  const header = Buffer.concat([MAGIC, Buffer.from([kdf.logN, kdf.r, kdf.p]), salt, iv])
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(header)

  const src = createReadStream(srcPath)
  const dest = createWriteStream(destPath)

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      reject(err)
    }
    src.on('error', fail)
    cipher.on('error', fail)
    dest.on('error', fail)
    dest.on('finish', () => {
      if (settled) return
      settled = true
      resolve()
    })

    dest.write(header)
    src.pipe(cipher).pipe(dest, { end: false })
    cipher.on('end', () => {
      dest.end(cipher.getAuthTag())
    })
  }).catch((err) => {
    unlink(destPath, () => {})
    throw err
  })
}

/** Decrypt a TOTALBK2 (or an older TOTALBK1) file produced by `encryptFile`. Throws on wrong
 *  passphrase / corruption. */
export async function decryptFile(srcPath: string, destPath: string, passphrase: string): Promise<void> {
  const size = statSync(srcPath).size
  if (size < HEADER_LEN_V1 + TAG_LEN) throw new Error(WRONG_PASSPHRASE)

  const fd = openSync(srcPath, 'r')
  let head: Buffer
  let tag: Buffer
  try {
    head = Buffer.alloc(Math.min(HEADER_LEN_V2, size - TAG_LEN))
    readSync(fd, head, 0, head.length, 0)
    tag = Buffer.alloc(TAG_LEN)
    readSync(fd, tag, 0, TAG_LEN, size - TAG_LEN)
  } finally {
    closeSync(fd)
  }

  const magic = head.subarray(0, MAGIC.length)
  let headerLen: number
  let kdf: BackupKdf
  if (magic.equals(MAGIC)) {
    if (head.length < HEADER_LEN_V2) throw new Error(WRONG_PASSPHRASE)
    headerLen = HEADER_LEN_V2
    kdf = { logN: head[8]!, r: head[9]!, p: head[10]! }
    if (!kdfInRange(kdf)) throw new Error(WRONG_PASSPHRASE)
  } else if (magic.equals(MAGIC_V1)) {
    headerLen = HEADER_LEN_V1
    kdf = V1_KDF
  } else {
    throw new Error(WRONG_PASSPHRASE)
  }
  const header = head.subarray(0, headerLen)
  const salt = header.subarray(headerLen - IV_LEN - SALT_LEN, headerLen - IV_LEN)
  const iv = header.subarray(headerLen - IV_LEN, headerLen)
  const key = await deriveKey(passphrase, salt, kdf)

  let decipher: DecipherGCM
  try {
    decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    // TOTALBK2 binds its header (format + cost); TOTALBK1 had no associated data.
    if (headerLen === HEADER_LEN_V2) decipher.setAAD(header)
  } catch {
    throw new Error(WRONG_PASSPHRASE)
  }

  const ciphertextLen = size - headerLen - TAG_LEN
  const dest = createWriteStream(destPath)

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const fail = (err: Error): void => {
        if (settled) return
        settled = true
        reject(err)
      }
      dest.on('error', fail)
      dest.on('finish', () => {
        if (settled) return
        settled = true
        resolve()
      })
      if (ciphertextLen === 0) {
        // No body — GCM still needs final() run to validate the tag against empty ciphertext.
        dest.end(decipher.final())
        return
      }
      const src = createReadStream(srcPath, { start: headerLen, end: headerLen + ciphertextLen - 1 })
      decipher.on('error', fail)
      src.on('error', fail)
      src.pipe(decipher).pipe(dest)
    })
  } catch {
    unlink(destPath, () => {})
    throw new Error(WRONG_PASSPHRASE)
  }
}
