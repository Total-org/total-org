// Phase 2c: the bundled HSN / SAC list IS the GST portal's file. The workbook is vendored
// byte-for-byte (its SHA-256 is pinned in sources.json) and hsnSac.json must equal what
// normalise.ts reads out of it. Regenerate only after replacing the workbook:
//   TOTAL_HSN_WRITE=1 npx vitest run src/shared/gst/hsnMaster
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { readXlsx } from '../../xlsx'
import { HSN_MASTER_FILE, hsnMasterJson, normaliseHsnWorkbook, type HsnMasterData } from './normalise'

const DIR = __dirname
const inflate = (b: Uint8Array, n: number): Uint8Array => new Uint8Array(inflateRawSync(b, { maxOutputLength: n + 1 }))
const sources = JSON.parse(readFileSync(join(DIR, 'sources.json'), 'utf8')) as { files: Record<string, { sha256: string; bytes: number; url: string }> }
const bytes = readFileSync(join(DIR, HSN_MASTER_FILE))
const fromWorkbook = normaliseHsnWorkbook(readXlsx(new Uint8Array(bytes), inflate))

if (process.env.TOTAL_HSN_WRITE === '1') writeFileSync(join(DIR, 'hsnSac.json'), hsnMasterJson(fromWorkbook))

const shippedText = readFileSync(join(DIR, 'hsnSac.json'), 'utf8')
const shipped = JSON.parse(shippedText) as HsnMasterData

describe('HSN / SAC master', () => {
  it('the vendored workbook is the file in sources.json, byte for byte', () => {
    const meta = sources.files[HSN_MASTER_FILE]!
    expect(meta.url).toMatch(/^https:\/\/tutorial\.gst\.gov\.in\//)
    expect(bytes.length).toBe(meta.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256)
  })

  it('hsnSac.json equals the workbook (only whitespace normalised)', () => {
    expect(shipped).toEqual(fromWorkbook)
    expect(shippedText).toBe(hsnMasterJson(fromWorkbook))
  })

  it('holds every row of both sheets, codes digits only (two printed twice)', () => {
    expect(shipped.goods).toHaveLength(21935)
    expect(shipped.services).toHaveLength(681)
    const codes = [...shipped.goods, ...shipped.services].map(([c]) => c)
    // The sheet prints two codes twice: once as "2307 00" / "2514 00" (heading~line wording) and
    // once plainly. Both rows are kept as published; createHsnIndex keeps the first per code.
    const seen = new Set<string>()
    expect(codes.filter((c) => (seen.has(c) ? true : (seen.add(c), false)))).toEqual(['230700', '251400'])
    for (const c of codes) expect(c).toMatch(/^\d{2,8}$/)
    // Rows read straight off the sheets (hand-checked in the workbook).
    expect(shipped.goods[0]).toEqual(['01', 'LIVE ANIMALS'])
    expect(shipped.goods).toContainEqual(['0101', 'LIVE HORSES, ASSES, MULES AND HINNIES.'])
    expect(shipped.goods).toContainEqual(['86090090', 'Other'])
    expect(shipped.services[0]).toEqual(['99', 'All Services'])
    expect(shipped.services).toContainEqual(['9954', 'Construction services'])
    // "2307 00" in the sheet → "230700"; the cell's line break → one space.
    expect(shipped.goods.find(([c]) => c === '230700')?.[1]).toBe('RESIDUES AND WASTE FROM THE FOOD INDUSTRIES; PREPARED ANIMAL FODDER~Wine lees; argol')
    expect(shipped.goods.find(([c]) => c === '251400')?.[1]).toContain('otherwise, into blocks')
  })

  it('stays a reasonable size for a lazily loaded chunk', () => {
    expect(shippedText.length).toBeLessThan(1_600_000)
  })
})
