// Plain vitest (pure Node crypto/fs — no electron, no better-sqlite3). Matches src/main/**/*.test.ts
// so it runs under `npm test`, not `npm run test:db`.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, statSync, truncateSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createCipheriv, randomBytes, scryptSync } from 'crypto'
import { encryptFile, decryptFile, MAGIC } from './crypt'

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'total-crypt-'))
}

describe('encryptFile / decryptFile', () => {
  it('round-trips arbitrary binary content', async () => {
    const dir = tmpDir()
    const srcPath = join(dir, 'src.bin')
    const encPath = join(dir, 'out.totalbak')
    const outPath = join(dir, 'restored.bin')
    const content = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256))
    writeFileSync(srcPath, content)

    await encryptFile(srcPath, encPath, 'correct horse battery staple')

    const encrypted = readFileSync(encPath)
    expect(encrypted.subarray(0, 8).toString('utf8')).toBe(MAGIC.toString('utf8'))
    expect(encrypted.subarray(0, 8)).not.toEqual(content.subarray(0, 8))

    await decryptFile(encPath, outPath, 'correct horse battery staple')
    const restored = readFileSync(outPath)
    expect(restored.equals(content)).toBe(true)
  })

  it('round-trips an empty file', async () => {
    const dir = tmpDir()
    const srcPath = join(dir, 'empty.bin')
    const encPath = join(dir, 'empty.totalbak')
    const outPath = join(dir, 'empty-out.bin')
    writeFileSync(srcPath, Buffer.alloc(0))

    await encryptFile(srcPath, encPath, 'passphrase12')
    await decryptFile(encPath, outPath, 'passphrase12')

    expect(readFileSync(outPath).length).toBe(0)
  })

  it('throws a clear error on the wrong passphrase', async () => {
    const dir = tmpDir()
    const srcPath = join(dir, 'src.bin')
    const encPath = join(dir, 'out.totalbak')
    const outPath = join(dir, 'restored.bin')
    writeFileSync(srcPath, Buffer.from('hello world, this is a company database snapshot'))

    await encryptFile(srcPath, encPath, 'right-passphrase')

    await expect(decryptFile(encPath, outPath, 'wrong-passphrase')).rejects.toThrow(
      'Wrong passphrase or corrupted file'
    )
  })

  it('throws a clear error on a truncated file', async () => {
    const dir = tmpDir()
    const srcPath = join(dir, 'src.bin')
    const encPath = join(dir, 'out.totalbak')
    const outPath = join(dir, 'restored.bin')
    writeFileSync(srcPath, Buffer.from('some company database content, long enough to matter here'))

    await encryptFile(srcPath, encPath, 'a-passphrase')
    const size = statSync(encPath).size
    truncateSync(encPath, size - 4)

    await expect(decryptFile(encPath, outPath, 'a-passphrase')).rejects.toThrow(
      'Wrong passphrase or corrupted file'
    )
  })

  it('throws a clear error when the magic header does not match', async () => {
    const dir = tmpDir()
    const notEncPath = join(dir, 'plain.totalbak')
    const outPath = join(dir, 'restored.bin')
    writeFileSync(notEncPath, Buffer.alloc(64, 1))

    await expect(decryptFile(notEncPath, outPath, 'whatever')).rejects.toThrow(
      'Wrong passphrase or corrupted file'
    )
  })

  it('new exports are TOTALBK2 with scrypt N = 2^17, r = 8, p = 1 in the header (audit A4 / SEC-9)', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'src.bin'), Buffer.from('books'))
    await encryptFile(join(dir, 'src.bin'), join(dir, 'out.totalbak'), 'a long passphrase')
    const head = readFileSync(join(dir, 'out.totalbak')).subarray(0, 11)
    expect(head.subarray(0, 8).toString('utf8')).toBe('TOTALBK2')
    expect([...head.subarray(8, 11)]).toEqual([17, 8, 1])
  })

  it('an export from before (TOTALBK1, scrypt N = 2^14, built here by hand) still imports', async () => {
    const dir = tmpDir()
    const content = Buffer.from('an old .totalbak made before audit A4')
    const salt = randomBytes(16)
    const iv = randomBytes(12)
    const key = scryptSync('old passphrase', salt, 32, { N: 16384, r: 8, p: 1 })
    const c = createCipheriv('aes-256-gcm', key, iv)
    const body = Buffer.concat([c.update(content), c.final()])
    writeFileSync(join(dir, 'old.totalbak'), Buffer.concat([Buffer.from('TOTALBK1'), salt, iv, body, c.getAuthTag()]))
    await decryptFile(join(dir, 'old.totalbak'), join(dir, 'old.db'), 'old passphrase')
    expect(readFileSync(join(dir, 'old.db')).equals(content)).toBe(true)
    await expect(decryptFile(join(dir, 'old.totalbak'), join(dir, 'x.db'), 'wrong')).rejects.toThrow('Wrong passphrase or corrupted file')
  })

  it('a lowered cost written into the header fails (the header is authenticated)', async () => {
    const dir = tmpDir()
    writeFileSync(join(dir, 'src.bin'), Buffer.from('books'))
    // Encrypted at the minimum cost (fast); then the header claims another cost.
    await encryptFile(join(dir, 'src.bin'), join(dir, 'out.totalbak'), 'a long passphrase', { logN: 14, r: 8, p: 1 })
    await decryptFile(join(dir, 'out.totalbak'), join(dir, 'ok.db'), 'a long passphrase')
    const bytes = readFileSync(join(dir, 'out.totalbak'))
    bytes[8] = 15
    writeFileSync(join(dir, 'tampered.totalbak'), bytes)
    await expect(decryptFile(join(dir, 'tampered.totalbak'), join(dir, 'x.db'), 'a long passphrase')).rejects.toThrow('Wrong passphrase or corrupted file')
    bytes[8] = 30 // a forged huge cost is refused before scrypt runs
    writeFileSync(join(dir, 'huge.totalbak'), bytes)
    await expect(decryptFile(join(dir, 'huge.totalbak'), join(dir, 'y.db'), 'a long passphrase')).rejects.toThrow('Wrong passphrase or corrupted file')
  })
})
