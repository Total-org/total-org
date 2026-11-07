import { readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { CA_DOC_END, CA_DOC_START, CA_PLACES, CA_POINTS, applies, caCheckDocBlock, caPointKey, caPointsAt, isBadged, type CaListName, type CaPoint } from '../shared/caCheck'
import { en } from '../shared/i18n'
import { ASSISTANT_UNVERIFIED } from '../shared/assistantSources'
import { COMPLIANCE_UNVERIFIED } from '../shared/compliance'
import { FIXED_ASSET_UNVERIFIED } from '../shared/fixedAssetSources'
import { EINVOICE_APPLICABILITY_UNVERIFIED } from '../shared/gst/einvoiceApplicability'
import { GST_FILING_UNVERIFIED } from '../shared/gst/filing'
import { NIC_UNVERIFIED } from '../shared/gst/nicRecord'
import { GST_RATE_UNVERIFIED } from '../shared/gst/rateTable'
import { GST_REGISTRATION_UNVERIFIED } from '../shared/gst/registration'
import { GST_UNVERIFIED } from '../shared/gst/sources'
import { UNVERIFIED_WP37 } from '../shared/payrollStatutory'
import { TCS_UNVERIFIED } from '../shared/tcsSources'
import { TDS_INTEREST_UNVERIFIED } from '../shared/tdsInterest'
import { GATEWAY_UNVERIFIED } from './gstGateway/sources'

const ROOT = resolve(__dirname, '../..')
const POINTS: readonly CaPoint[] = CA_POINTS

/** Every UNVERIFIED list, as (key, text) entries — ids / keys where the list has them, else the
 *  position. */
type Entry = { key: string; text: string }
const strings = (xs: readonly string[]): Entry[] => xs.map((text, i) => ({ key: String(i), text }))
const LISTS: Record<CaListName, Entry[]> = {
  GST_FILING_UNVERIFIED: strings(GST_FILING_UNVERIFIED),
  COMPLIANCE_UNVERIFIED: strings(COMPLIANCE_UNVERIFIED),
  ASSISTANT_UNVERIFIED: ASSISTANT_UNVERIFIED.map((u) => ({ key: u.id, text: u.text })),
  GST_UNVERIFIED: GST_UNVERIFIED.map((u) => ({ key: u.id, text: u.text })),
  GST_RATE_UNVERIFIED: strings(GST_RATE_UNVERIFIED),
  GST_REGISTRATION_UNVERIFIED: strings(GST_REGISTRATION_UNVERIFIED),
  EINVOICE_APPLICABILITY_UNVERIFIED: strings(EINVOICE_APPLICABILITY_UNVERIFIED),
  NIC_UNVERIFIED: strings(NIC_UNVERIFIED),
  TCS_UNVERIFIED: TCS_UNVERIFIED.map((u) => ({ key: u.key, text: u.text })),
  TDS_INTEREST_UNVERIFIED: strings(TDS_INTEREST_UNVERIFIED),
  UNVERIFIED_WP37: strings(UNVERIFIED_WP37),
  FIXED_ASSET_UNVERIFIED: FIXED_ASSET_UNVERIFIED.map((u) => ({ key: u.key, text: u.text })),
  GATEWAY_UNVERIFIED: strings(GATEWAY_UNVERIFIED)
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name !== 'node_modules' && name !== '__tests__' && name !== '__fixtures__') walk(p, out)
    } else if (/\.tsx?$/.test(name) && !/\.(db)?test\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

describe('caCheck registry', () => {
  it('has unique ids, and every point is either badged somewhere or closed with a note', () => {
    const ids = POINTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of POINTS) {
      if (isBadged(p)) {
        expect(p.places.length, p.id).toBeGreaterThan(0)
        for (const pl of p.places) expect(Object.keys(CA_PLACES), p.id).toContain(pl)
      } else {
        expect(p.note.length, p.id).toBeGreaterThan(10)
      }
      if (isBadged(p)) expect(p.covers.length + p.questions.length, `${p.id} stands for nothing`).toBeGreaterThan(0)
    }
  })

  it('knows every exported UNVERIFIED list in the code (a new list needs its points here)', () => {
    const found = new Set<string>()
    for (const f of [...walk(join(ROOT, 'src/shared')), ...walk(join(ROOT, 'src/main'))]) {
      for (const m of readFileSync(f, 'utf8').matchAll(/export const (\w*UNVERIFIED\w*)\b/g)) found.add(m[1]!)
    }
    // An alias of EINVOICE_APPLICABILITY_UNVERIFIED, and a meta key that only shares the word.
    found.delete('EINVOICE_COMPLIANCE_UNVERIFIED')
    found.delete('OPEN_BACKUP_UNVERIFIED_KEY')
    expect([...found].sort()).toEqual(Object.keys(LISTS).sort())
  })

  it('covers every entry of every UNVERIFIED list — each one badged or listed as closed', () => {
    const covered = new Map<string, string[]>()
    for (const p of POINTS) {
      for (const ref of p.covers) {
        const entries = LISTS[ref.list]
        let hit: Entry[]
        if ('all' in ref) hit = entries
        else if ('id' in ref) hit = entries.filter((e) => e.key === ref.id)
        else {
          const e = entries[ref.at]
          expect(e, `${p.id}: ${ref.list}[${ref.at}] does not exist`).toBeDefined()
          expect(e!.text, `${p.id}: ${ref.list}[${ref.at}] moved — it no longer says "${ref.has}"`).toContain(ref.has)
          hit = [e!]
        }
        expect(hit.length, `${p.id}: ${JSON.stringify(ref)} matches nothing`).toBeGreaterThan(0)
        for (const e of hit) covered.set(`${ref.list}:${e.key}`, [...(covered.get(`${ref.list}:${e.key}`) ?? []), p.id])
      }
    }
    const missing: string[] = []
    for (const [list, entries] of Object.entries(LISTS)) {
      expect(entries.length, `${list} is empty`).toBeGreaterThan(0)
      for (const e of entries) if (!covered.has(`${list}:${e.key}`)) missing.push(`${list}[${e.key}]: ${e.text.slice(0, 80)}`)
    }
    expect(missing).toEqual([])
    const twice = [...covered].filter(([, ids]) => ids.length > 1)
    expect(twice).toEqual([])
  })

  it('covers every question in docs/owner/09-questions-for-your-ca.md, and names only questions that exist', () => {
    const doc = readFileSync(join(ROOT, 'docs/owner/09-questions-for-your-ca.md'), 'utf8')
    const asked = [...doc.matchAll(/^ {0,4}(\d+)\. \*\*/gm)].map((m) => Number(m[1]))
    expect(asked.length).toBeGreaterThan(50)
    const named = new Set(POINTS.flatMap((p) => p.questions))
    expect(asked.filter((q) => !named.has(q))).toEqual([])
    expect([...named].filter((q) => !asked.includes(q))).toEqual([])
  })

  it('gives every badged point a plain sentence in the English catalogue (hi / hinglish by the parity test)', () => {
    const cat = en as Record<string, string>
    for (const p of POINTS) {
      const key = caPointKey(p.id)
      if (isBadged(p)) expect(cat[key], key).toBeTruthy()
      else expect(cat[key], `${key}: a closed point shows no badge`).toBeUndefined()
    }
    const pointKeys = Object.keys(cat).filter((k) => k.startsWith('common.caCheck.point.'))
    expect(pointKeys.sort()).toEqual(POINTS.filter(isBadged).map((p) => caPointKey(p.id)).sort())
  })

  it('filters by context: quarterly-only and date-bound points', () => {
    expect(caPointsAt('simple.taxes.dueGstr3b').map((p) => p.id)).toEqual(['gst-due-dates'])
    expect(caPointsAt('simple.taxes.dueGstr3b', { quarterly: true }).map((p) => p.id)).toEqual(['gst-due-dates', 'gstr3b-quarterly'])
    expect(caPointsAt('simple.taxes.pmt06')).toEqual([])
    expect(caPointsAt('simple.ratePicker', { date: '2025-09-21' }).map((p) => p.id)).toEqual(['gst-slab-choice'])
    expect(caPointsAt('simple.ratePicker', { date: '2025-09-22' }).map((p) => p.id)).toEqual(['gst-slabs-new', 'gst-services-rates', 'gst-slab-choice'])
    expect(caPointsAt('simple.ratePicker').map((p) => p.id)).toEqual(['gst-slab-choice'])
    const closed = POINTS.find((p) => !isBadged(p))!
    expect(applies(closed)).toBe(false)
    // Every place shows something in its widest context (no dead place).
    for (const place of Object.keys(CA_PLACES) as (keyof typeof CA_PLACES)[]) {
      expect(caPointsAt(place, { quarterly: true, date: '2099-01-01' }).length, place).toBeGreaterThan(0)
    }
  })

  it('every place is used by the renderer, and the renderer uses no unknown place', () => {
    const used = new Map<string, number>()
    for (const f of walk(join(ROOT, 'src/renderer/src'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/<(?:CaCheck|UnverifiedBanner)\b[^>]*?\bplace="([^"]+)"/g)) used.set(m[1]!, (used.get(m[1]!) ?? 0) + 1)
    }
    expect([...used.keys()].filter((p) => !(p in CA_PLACES))).toEqual([])
    expect(Object.keys(CA_PLACES).filter((p) => !used.has(p))).toEqual([])
  })

  it('docs/owner/09 holds the block generated from the registry (TOTAL_WRITE_CA_DOC=1 rewrites it)', () => {
    const path = join(ROOT, 'docs/owner/09-questions-for-your-ca.md')
    const doc = readFileSync(path, 'utf8')
    const block = caCheckDocBlock((k) => (en as Record<string, string>)[k] ?? k)
    const start = doc.indexOf(CA_DOC_START)
    const end = doc.indexOf(CA_DOC_END)
    if (process.env.TOTAL_WRITE_CA_DOC === '1') {
      const next = start >= 0 && end > start ? doc.slice(0, start) + block + doc.slice(end + CA_DOC_END.length) : `${doc.trimEnd()}\n\n---\n\n${block}\n`
      writeFileSync(path, next)
      return
    }
    expect(start, 'run TOTAL_WRITE_CA_DOC=1 npx vitest run src/main/caCheck.test.ts').toBeGreaterThanOrEqual(0)
    expect(doc.slice(start, end + CA_DOC_END.length)).toBe(block)
  })
})
