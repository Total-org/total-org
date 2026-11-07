// Phase 2c: the HSN / SAC list (~1.5 MB) never reaches a startup bundle — no module imports
// hsnSac.json statically; renderer lib/hsnMaster.ts and main hsnMaster.ts load it on demand.
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..', '..', '..')
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : files(p)
    return /\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|dbtest)\.(ts|tsx)$/.test(name) && !p.includes('__tests__') ? [p] : []
  })
}
const STATIC = /^\s*(?:import|export)\b[^'"]*from\s+['"][^'"]*hsnSac\.json['"]|^\s*import\s+['"][^'"]*hsnSac\.json['"]|require\(\s*['"][^'"]*hsnSac\.json/m

describe('HSN / SAC list is loaded lazily', () => {
  it('no source module imports hsnSac.json statically', () => {
    const offenders = ['renderer', 'shared', 'main', 'preload']
      .flatMap((d) => files(join(ROOT, 'src', d)))
      .filter((p) => STATIC.test(readFileSync(p, 'utf8')))
      .map((p) => relative(ROOT, p))
    expect(offenders).toEqual([])
  })

  it('the renderer and main load it with a dynamic import', () => {
    for (const f of [join('src', 'renderer', 'src', 'lib', 'hsnMaster.ts'), join('src', 'main', 'hsnMaster.ts')]) {
      expect(readFileSync(join(ROOT, f), 'utf8')).toContain("import('@shared/gst/hsnMaster/hsnSac.json')")
    }
  })
})
