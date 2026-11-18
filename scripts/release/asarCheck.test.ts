import { describe, it, expect, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createPackage } from '@electron/asar'
import { forbiddenEntries, isAppArchive } from './asar-check.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'total-asar-check-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A real archive built from `files` (path → text), as electron-builder writes app.asar. */
async function archive(name: string, files: Record<string, string>): Promise<string> {
  const dir = join(scratch, name)
  for (const [p, text] of Object.entries(files)) {
    mkdirSync(join(dir, p, '..'), { recursive: true })
    writeFileSync(join(dir, p), text)
  }
  const out = join(scratch, `${name}.asar`)
  await createPackage(dir, out)
  return out
}

/** The CLI's exit code and output. */
function check(asar: string): { code: number; out: string } {
  try {
    return { code: 0, out: execFileSync(process.execPath, ['scripts/release/asar-check.mjs', asar], { encoding: 'utf8', stdio: 'pipe' }) }
  } catch (err) {
    const e = err as { status: number; stderr: string }
    return { code: e.status, out: e.stderr }
  }
}

describe('SEC3-3: the shipped app.asar carries no type-check output', () => {
  it('picks out out/types-* and .tsbuildinfo, in either separator', () => {
    expect(forbiddenEntries(['/out/main/index.js', '/out/types-node/tsconfig.node.tsbuildinfo', '/out/types-web', '/package.json'])).toEqual([
      '/out/types-node/tsconfig.node.tsbuildinfo',
      '/out/types-web'
    ])
    expect(forbiddenEntries(['\\out\\types-web\\x.d.ts', '\\out\\renderer\\index.html'])).toEqual(['/out/types-web/x.d.ts'])
    expect(forbiddenEntries(['/out/main/types-of-things.js', '/out/renderer/types-x.js'])).toEqual([])
    expect(isAppArchive(['\\out\\main\\index.js'])).toBe(true)
    expect(isAppArchive(['/out/renderer/index.html'])).toBe(false)
  })

  it('fails on a packaged archive that ships them, passes one that does not', async () => {
    const app = { 'out/main/index.js': '', 'out/renderer/index.html': '', 'package.json': '{}' }
    const leaky = check(await archive('leaky', { ...app, 'out/types-node/tsconfig.node.tsbuildinfo': '{"root":["/Users/x/src/main/index.ts"]}' }))
    expect(leaky.code).toBe(1)
    expect(leaky.out).toContain('/out/types-node/tsconfig.node.tsbuildinfo')
    expect(check(await archive('clean', app))).toMatchObject({ code: 0 })
    // Not the app's archive (a wrong path would otherwise pass with nothing listed).
    expect(check(await archive('other', { 'index.js': '' })).code).toBe(1)
  })
})
