/**
 * G8 — GST golden-fixture suite. A deterministic document book covering every GSTR-1
 * table (intra B2B with two cess rates, inter B2CL, B2CS, registered + unregistered
 * notes, a debit note, export WPAY, SEZ WOP, nil-rated, a service invoice and an
 * advance receipt) is asserted table-by-table against portal-schema golden JSON in
 * __fixtures__/. Any snapshot change here must be checked against the GSTN offline-tool
 * spec — never blind re-recorded.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  applySetOff, buildGstr1, buildGstr3b, classifyDoc, B2CL_THRESHOLD_PAISE, b2clLimitOn, b2clLabelForPeriod, B2CL_SUMMARY_LABEL,
  type GstDoc, type Gstr1Extras, type Gstr3bInputs
} from './returns'
import {
  buildEInvoiceJson, buildEwbJson, ewbEligibility, ewbIssues, splitAddress,
  EWB_THRESHOLD_PAISE, type EdocCompany, type EdocInvoice
} from './edocs'
import { notRegularDaysIssue, validateGstr1 } from './validate'
import { backOutAdvance } from './calc'
import { isUqc, toUqc, UQC_CODES } from './uqc'
import { singleEinvoiceDoc, singleEwbBill } from './edocs.testutil'
import { jsonAt } from '../jsonAt.testutil'

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8'))

const COMPANY_GSTIN = '27AAPFU0939F1ZV'
const COMPANY_STATE = '27'
const PERIOD = '072026'
const CTIN_1 = '27AAPFU0939F1ZV' // registered buyer (also SVC-1)
const CTIN_SEZ = '27AABCS1429B1ZU' // SEZ unit
const CTIN_29 = '29AACCR7832C1ZD' // registered buyer, Karnataka (nil-rated doc)

const zeroValidation = { valDiff: 0, missingHsnCount: 0, missingGstin: false }

/** The fixture book. Amounts in paise; tax figures follow the line-level computeGst convention. */
function fixtureDocs(): GstDoc[] {
  return [
    // d1 — intra B2B with TWO cess rates at one GST rate (D1: single rt bucket, cess summed)
    {
      voucherId: 1, kind: 'sales', date: '2026-07-05', number: 'INV-1',
      partyName: 'Umbrella Retail', partyGstin: CTIN_1, pos: '27', invoiceValue: 2030000,
      items: [{ rate: 28, taxable: 1500000, cgst: 210000, sgst: 210000, igst: 0, cess: 110000 }],
      hsnLines: [
        { hsn: '2402', description: 'Cigarettes King', uqc: 'BOX', qtyMilli: 10000, rate: 28, taxable: 1000000, cgst: 140000, sgst: 140000, igst: 0, cess: 50000 },
        { hsn: '2403', description: 'Tobacco blend', uqc: 'BOX', qtyMilli: 5000, rate: 28, taxable: 500000, cgst: 70000, sgst: 70000, igst: 0, cess: 60000 }
      ],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d2 — inter B2CL (above the ₹1,00,000 threshold)
    {
      voucherId: 2, kind: 'sales', date: '2026-07-06', number: 'INV-2',
      partyName: 'Cash buyer', partyGstin: null, pos: '29', invoiceValue: 11800000,
      items: [{ rate: 18, taxable: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0 }],
      hsnLines: [{ hsn: '8471', description: 'Laptop 14', uqc: 'PCS', qtyMilli: 2000, rate: 18, taxable: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d3 — inter B2CS
    {
      voucherId: 3, kind: 'sales', date: '2026-07-07', number: 'INV-3',
      partyName: null, partyGstin: null, pos: '29', invoiceValue: 525000,
      items: [{ rate: 5, taxable: 500000, cgst: 0, sgst: 0, igst: 25000, cess: 0 }],
      hsnLines: [{ hsn: '1001', description: 'Wheat', uqc: 'KGS', qtyMilli: 100000, rate: 5, taxable: 500000, cgst: 0, sgst: 0, igst: 25000, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d4 — intra B2CS
    {
      voucherId: 4, kind: 'sales', date: '2026-07-08', number: 'INV-4',
      partyName: null, partyGstin: null, pos: '27', invoiceValue: 210000,
      items: [{ rate: 5, taxable: 200000, cgst: 5000, sgst: 5000, igst: 0, cess: 0 }],
      hsnLines: [{ hsn: '1001', description: 'Wheat', uqc: 'KGS', qtyMilli: 40000, rate: 5, taxable: 200000, cgst: 5000, sgst: 5000, igst: 0, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d5 — CRN to a registered buyer (cdnr, ntty C)
    {
      voucherId: 5, kind: 'credit_note', date: '2026-07-09', number: 'CRN-1',
      partyName: 'Umbrella Retail', partyGstin: CTIN_1, pos: '27', invoiceValue: 266000,
      items: [{ rate: 28, taxable: 200000, cgst: 28000, sgst: 28000, igst: 0, cess: 10000 }],
      hsnLines: [{ hsn: '2402', description: 'Cigarettes King', uqc: 'BOX', qtyMilli: 2000, rate: 28, taxable: 200000, cgst: 28000, sgst: 28000, igst: 0, cess: 10000 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d6 — CRN to an unregistered buyer, B2CL-sized (cdnur typ B2CL)
    {
      voucherId: 6, kind: 'credit_note', date: '2026-07-10', number: 'CRN-2',
      partyName: 'Cash buyer', partyGstin: null, pos: '29', invoiceValue: 11800000,
      items: [{ rate: 18, taxable: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0 }],
      hsnLines: [{ hsn: '8471', description: 'Laptop 14', uqc: 'PCS', qtyMilli: 2000, rate: 18, taxable: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d7 — small unregistered CRN — nets into B2CS, never CDNUR
    {
      voucherId: 7, kind: 'credit_note', date: '2026-07-11', number: 'CRN-3',
      partyName: null, partyGstin: null, pos: '27', invoiceValue: 52500,
      items: [{ rate: 5, taxable: 50000, cgst: 1250, sgst: 1250, igst: 0, cess: 0 }],
      hsnLines: [{ hsn: '1001', description: 'Wheat', uqc: 'KGS', qtyMilli: 10000, rate: 5, taxable: 50000, cgst: 1250, sgst: 1250, igst: 0, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d8 — DBN to a registered buyer ('D' path is reachable — audit fix)
    {
      voucherId: 8, kind: 'debit_note', date: '2026-07-12', number: 'DBN-1',
      partyName: 'Umbrella Retail', partyGstin: CTIN_1, pos: '27', invoiceValue: 118000,
      items: [{ rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }],
      hsnLines: [{ hsn: '8517', description: 'Router', uqc: 'PCS', qtyMilli: 1000, rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d9 — export WITH payment (Table 6A WPAY, IGST charged)
    {
      voucherId: 9, kind: 'sales', date: '2026-07-13', number: 'EXP-1',
      partyName: 'Acme GmbH', partyGstin: null, pos: '96', invoiceValue: 5900000,
      items: [{ rate: 18, taxable: 5000000, cgst: 0, sgst: 0, igst: 900000, cess: 0 }],
      hsnLines: [{ hsn: '8471', description: 'Laptop 14', uqc: 'PCS', qtyMilli: 1000, rate: 18, taxable: 5000000, cgst: 0, sgst: 0, igst: 900000, cess: 0 }],
      nilLines: [], invTyp: 'EXPWP', rchrg: false,
      shippingBill: { num: 'SB-77', date: '2026-07-10' }, validation: zeroValidation
    },
    // d10 — SEZ WITHOUT payment (zero-rated, no tax charged; stays in b2b with inv_typ SEWOP)
    {
      voucherId: 10, kind: 'sales', date: '2026-07-15', number: 'SEZ-1',
      partyName: 'SEZ Unit One', partyGstin: CTIN_SEZ, pos: '27', invoiceValue: 300000,
      items: [{ rate: 18, taxable: 300000, cgst: 0, sgst: 0, igst: 0, cess: 0 }],
      hsnLines: [{ hsn: '9983', description: 'Consulting SEZ', uqc: 'OTH', qtyMilli: 0, rate: 18, taxable: 300000, cgst: 0, sgst: 0, igst: 0, cess: 0 }],
      nilLines: [], invTyp: 'SEWOP', rchrg: false, validation: zeroValidation
    },
    // d11 — nil-rated intra to an unregistered buyer (Table 8 INTRAB2C)
    {
      voucherId: 11, kind: 'sales', date: '2026-07-16', number: 'NIL-1',
      partyName: null, partyGstin: null, pos: '27', invoiceValue: 100000,
      items: [], hsnLines: [{ hsn: '1006', description: 'Rice', uqc: 'KGS', qtyMilli: 50000, rate: 0, taxable: 100000, cgst: 0, sgst: 0, igst: 0, cess: 0 }],
      nilLines: [{ taxable: 100000 }], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d12 — nil-rated inter to a REGISTERED buyer (Table 8 INTRB2B; must NOT emit an empty b2b invoice)
    {
      voucherId: 12, kind: 'sales', date: '2026-07-17', number: 'NIL-2',
      partyName: 'Karnataka Traders', partyGstin: CTIN_29, pos: '29', invoiceValue: 40000,
      items: [], hsnLines: [{ hsn: '1006', description: 'Rice', uqc: 'KGS', qtyMilli: 20000, rate: 0, taxable: 40000, cgst: 0, sgst: 0, igst: 0, cess: 0 }],
      nilLines: [{ taxable: 40000 }], invTyp: 'R', rchrg: false, validation: zeroValidation
    },
    // d13 — service invoice (SAC, qty 0/OTH)
    {
      voucherId: 13, kind: 'sales', date: '2026-07-18', number: 'SVC-1',
      partyName: 'Umbrella Retail', partyGstin: CTIN_1, pos: '27', invoiceValue: 295000,
      items: [{ rate: 18, taxable: 250000, cgst: 22500, sgst: 22500, igst: 0, cess: 0 }],
      hsnLines: [{ hsn: '9983', description: 'Consulting services ABC', uqc: 'OTH', qtyMilli: 0, rate: 18, taxable: 250000, cgst: 22500, sgst: 22500, igst: 0, cess: 0 }],
      nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    }
  ]
}

const fixtureExtras: Gstr1Extras = {
  // Advance receipt: ₹1,000 intra at 18% (11A)
  advances: [{ pos: '27', supply: 'intra', rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }],
  advanceAdjustments: [],
  docSeries: [
    { category: 1, from: 'INV-1', to: 'INV-4', totnum: 4, cancel: 1 },
    { category: 4, from: 'DBN-1', to: 'DBN-1', totnum: 1, cancel: 0 },
    { category: 5, from: 'CRN-1', to: 'CRN-3', totnum: 3, cancel: 0 }
  ],
  gt: 250000000,
  curGt: 300000000
}

describe('GSTR-1 golden fixture', () => {
  const result = buildGstr1(fixtureDocs(), COMPANY_GSTIN, COMPANY_STATE, PERIOD, fixtureExtras)
  const json = result.json
  const golden = fixture('gstr1-golden.json')

  it('every expected table is PRESENT (missing sections are visible failures forever)', () => {
    for (const key of ['gstin', 'fp', 'gt', 'cur_gt', 'b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'at', 'doc_issue', 'hsn']) {
      expect(json, `section '${key}' missing from GSTR-1 JSON`).toHaveProperty(key)
    }
    expect(json.hsn).toHaveProperty('hsn_b2b')
    expect(json.hsn).toHaveProperty('hsn_b2c')
  })

  it('header matches (gt/cur_gt computed, not hardcoded zeros)', () => {
    expect(json.gstin).toBe(jsonAt(golden, 'gstin'))
    expect(json.fp).toBe(jsonAt(golden, 'fp'))
    expect(json.gt).toBe(jsonAt(golden, 'gt'))
    expect(json.cur_gt).toBe(jsonAt(golden, 'cur_gt'))
  })

  it('b2b (4A) — grouped by ctin, inv_typ R/SEWOP, rchrg, D1 single-rate bucket with summed cess', () => {
    expect(json.b2b).toEqual(jsonAt(golden, 'b2b'))
  })
  it('b2cl (5) — inter-state unregistered above ₹1,00,000', () => {
    expect(json.b2cl).toEqual(jsonAt(golden, 'b2cl'))
    expect(B2CL_THRESHOLD_PAISE).toBe(10000000)
  })
  it('b2cs (7) — aggregated by pos+rate, small unregistered notes netted in', () => {
    expect(json.b2cs).toEqual(jsonAt(golden, 'b2cs'))
  })
  it('cdnr (9B registered) — C and D note types', () => {
    expect(json.cdnr).toEqual(jsonAt(golden, 'cdnr'))
  })
  it('cdnur (9B unregistered) — B2CL-type only', () => {
    expect(json.cdnur).toEqual(jsonAt(golden, 'cdnur'))
  })
  it('exp (6A) — WPAY group with shipping bill fields', () => {
    expect(json.exp).toEqual(jsonAt(golden, 'exp'))
  })
  it('nil (8) — split by supply/audience', () => {
    expect(json.nil).toEqual(jsonAt(golden, 'nil'))
  })
  it('at (11A) — advances received, rate-wise by pos', () => {
    expect(json.at).toEqual(jsonAt(golden, 'at'))
  })
  it('doc_issue (13) — series per document category, deleted counted as cancelled', () => {
    expect(json.doc_issue).toEqual(jsonAt(golden, 'doc_issue'))
  })
  it('hsn (12) — B2B/B2C bifurcation, netted notes, 2-decimal qty', () => {
    expect(json.hsn).toEqual(jsonAt(golden, 'hsn'))
  })
  it('txpd (11B) omitted when there are no adjustments', () => {
    expect(json).not.toHaveProperty('txpd')
  })

  it('rounding tie: signed taxable across tables 4+5+6+7+8+9B equals table 12 taxable', () => {
    // The offline-tool JSON is built as Record<string, unknown>: read each list / figure, failing
    // the test when it is not one.
    const listAt = (node: unknown, ...path: (string | number)[]): unknown[] => {
      const x = jsonAt(node, ...path)
      if (!Array.isArray(x)) throw new Error(`${path.join('.')} is not a list`)
      return x
    }
    const num = (x: unknown): number => {
      if (typeof x !== 'number') throw new Error(`${JSON.stringify(x)} is not a number`)
      return x
    }
    const sum = (rows: unknown[], value: (row: unknown) => number): number => rows.reduce<number>((s, r) => s + value(r), 0)
    const itmsTotal = (invs: unknown[]): number =>
      sum(invs, (i) => sum(listAt(i, 'itms'), (x) => num(jsonAt(x, 'itm_det', 'txval') ?? jsonAt(x, 'txval'))))
    const noteSign = (n: unknown): number => (jsonAt(n, 'ntty') === 'C' ? -1 : 1)
    const b2b = sum(listAt(json, 'b2b'), (g) => itmsTotal(listAt(g, 'inv')))
    const b2cl = sum(listAt(json, 'b2cl'), (g) => itmsTotal(listAt(g, 'inv')))
    const b2cs = sum(listAt(json, 'b2cs'), (r) => num(jsonAt(r, 'txval')))
    const exp = sum(listAt(json, 'exp'), (g) => itmsTotal(listAt(g, 'inv')))
    const cdnr = sum(listAt(json, 'cdnr'), (g) => sum(listAt(g, 'nt'), (n) => noteSign(n) * itmsTotal([n])))
    const cdnur = sum(listAt(json, 'cdnur'), (n) => noteSign(n) * itmsTotal([n]))
    const nil = sum(listAt(json, 'nil', 'inv'), (r) => num(jsonAt(r, 'nil_amt')))
    const hsn = sum([...listAt(json, 'hsn', 'hsn_b2b'), ...listAt(json, 'hsn', 'hsn_b2c')], (r) => num(jsonAt(r, 'txval')))
    expect(b2b + b2cl + b2cs + exp + cdnr + cdnur + nil).toBeCloseTo(hsn, 6)
  })

  it('summary rows cover every section', () => {
    const sections = result.summary.map((s) => s.section)
    expect(sections).toEqual([
      'b2b', 'b2cl', 'b2cs', 'exp', 'cdnr', 'cdnur', 'nil',
      'hsn_b2b', 'hsn_b2c', 'at', 'txpd', 'doc_issue'
    ])
  })
})

describe('classifyDoc', () => {
  it('maps export types and foreign state codes', () => {
    expect(classifyDoc('sez_wp', '27')).toBe('SEWP')
    expect(classifyDoc('sez_wop', '27')).toBe('SEWOP')
    expect(classifyDoc('exp_wp', null)).toBe('EXPWP')
    expect(classifyDoc('exp_wop', null)).toBe('EXPWOP')
    expect(classifyDoc(null, '96')).toBe('EXPWOP')
    expect(classifyDoc(null, '97')).toBe('EXPWOP')
    expect(classifyDoc(null, '27')).toBe('R')
    expect(classifyDoc(null, null)).toBe('R')
  })
})

describe('GSTR-3B golden fixture', () => {
  const inputs: Gstr3bInputs = {
    docs: fixtureDocs(),
    itc: {
      impg: { igst: 50000, cgst: 0, sgst: 0, cess: 0 },
      isrc: { igst: 0, cgst: 36000, sgst: 36000, cess: 0 },
      oth: { igst: 10000, cgst: 20000, sgst: 20000, cess: 5000 },
      blocked: { igst: 0, cgst: 3000, sgst: 3000, cess: 0 }
    },
    rcmInward: { taxable: 400000, igst: 0, cgst: 36000, sgst: 36000, cess: 0 },
    manual: {
      itcRevRul: { igst: 0, cgst: 1000, sgst: 1000, cess: 0 },
      itcRevOth: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      interest: { igst: 0, cgst: 0, sgst: 0, cess: 0 },
      lateFee: { camt: 0, samt: 0 }
    }
  }
  const r = buildGstr3b(inputs, COMPANY_GSTIN, PERIOD)

  it('json matches the golden fixture exactly', () => {
    expect(r.json).toEqual(fixture('gstr3b-golden.json'))
  })

  it('3.1(b) zero-rated carries exports + SEZ, separated from 3.1(a) and 3.1(c) (D6)', () => {
    expect(r.zeroRated).toEqual({ taxable: 5300000, igst: 900000, cess: 0 })
    expect(r.outward.taxable).toBe(2300000)
    expect(r.nilExempt.taxable).toBe(140000)
  })

  it('netPayable honours the set-off order; RCM stays cash-payable', () => {
    expect(r.netPayable).toEqual({ igst: 865000, cgst: 162250, sgst: 162250, cess: 95000 })
    expect(r.rcmPayable).toEqual({ igst: 0, cgst: 36000, sgst: 36000, cess: 0 })
  })
})

describe('applySetOff matrix', () => {
  it('IGST credit goes IGST → CGST → SGST', () => {
    expect(applySetOff({ igst: 100, cgst: 50, sgst: 50, cess: 0 }, { igst: 180, cgst: 0, sgst: 0, cess: 0 }))
      .toEqual({ igst: 0, cgst: 0, sgst: 20, cess: 0 })
  })
  it('CGST credit goes CGST → IGST, never SGST', () => {
    expect(applySetOff({ igst: 40, cgst: 30, sgst: 30, cess: 0 }, { igst: 0, cgst: 100, sgst: 0, cess: 0 }))
      .toEqual({ igst: 0, cgst: 0, sgst: 30, cess: 0 })
  })
  it('SGST credit goes SGST → IGST, never CGST', () => {
    expect(applySetOff({ igst: 40, cgst: 30, sgst: 30, cess: 0 }, { igst: 0, cgst: 0, sgst: 100, cess: 0 }))
      .toEqual({ igst: 0, cgst: 30, sgst: 0, cess: 0 })
  })
  it('cess credit only offsets cess', () => {
    expect(applySetOff({ igst: 10, cgst: 10, sgst: 10, cess: 5 }, { igst: 0, cgst: 0, sgst: 0, cess: 100 }))
      .toEqual({ igst: 10, cgst: 10, sgst: 10, cess: 0 })
  })
  it('combined: IGST credit exhausted first (IGST→CGST), then CGST/SGST credits mop up', () => {
    // IGST credit 120: clears igst 50, then 70 into cgst (100→30). CGST credit 40: clears
    // the remaining 30 (10 spills to igst, already 0). SGST credit 10: sgst 100→90.
    expect(applySetOff({ igst: 50, cgst: 100, sgst: 100, cess: 0 }, { igst: 120, cgst: 40, sgst: 10, cess: 0 }))
      .toEqual({ igst: 0, cgst: 0, sgst: 90, cess: 0 })
  })
})

// ---------- F1 regression: zero-rated docs with only rate-0 lines stay in 6A/6B ----------

describe('zero-rated documents with rate-0 lines (F1 #4)', () => {
  const expDoc = (over: Partial<GstDoc> = {}): GstDoc => ({
    voucherId: 90, kind: 'sales', date: '2026-07-20', number: 'EXP-9',
    partyName: 'Acme GmbH', partyGstin: null, pos: '96', invoiceValue: 500000,
    items: [], hsnLines: [{ hsn: '1006', description: 'Rice', uqc: 'KGS', qtyMilli: 250000, rate: 0, taxable: 500000, cgst: 0, sgst: 0, igst: 0, cess: 0 }],
    nilLines: [{ taxable: 500000 }], invTyp: 'EXPWOP', rchrg: false, validation: zeroValidation,
    ...over
  })

  it('an EXPWOP invoice of nil-rated goods appears in Table 6A at rt 0 — never in Table 8', () => {
    const r = buildGstr1([expDoc()], COMPANY_GSTIN, COMPANY_STATE, PERIOD)
    const json = r.json
    expect(json.exp).toEqual([
      {
        exp_typ: 'WOPAY',
        inv: [{
          inum: 'EXP-9', idt: '20-07-2026', val: 5000,
          itms: [{ txval: 5000, rt: 0, iamt: 0, csamt: 0 }]
        }]
      }
    ])
    expect(json.nil).toBeUndefined()
    // On-screen summary agrees: value on the exports row, nothing on the nil row.
    expect(r.summary.find((s) => s.section === 'exp')).toMatchObject({ docs: 1, taxable: 500000 })
    expect(r.summary.find((s) => s.section === 'nil')).toMatchObject({ taxable: 0 })
  })

  it('a same-state SEZ invoice whose lines are all rate-0 stays in b2b (6B), not Table 8', () => {
    const sez = expDoc({
      voucherId: 91, number: 'SEZ-9', partyName: 'SEZ Unit One', partyGstin: CTIN_SEZ,
      pos: '27', invTyp: 'SEWOP',
      items: [{ rate: 0, taxable: 500000, cgst: 0, sgst: 0, igst: 0, cess: 0 }], nilLines: []
    })
    const json = buildGstr1([sez], COMPANY_GSTIN, COMPANY_STATE, PERIOD).json
    expect(json.b2b).toHaveLength(1)
    expect(jsonAt(json, 'b2b', 0, 'inv', 0)).toMatchObject({ inum: 'SEZ-9', inv_typ: 'SEWOP' })
    expect(jsonAt(json, 'b2b', 0, 'inv', 0, 'itms', 0, 'itm_det')).toMatchObject({ rt: 0, txval: 5000 })
    expect(json.nil).toBeUndefined()
  })

  it('GSTR-3B files the same value as zero-rated 3.1(b) — consistent with GSTR-1, not 3.1(c)', () => {
    const r = buildGstr3b(
      { docs: [expDoc()], itc: { impg: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, isrc: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, oth: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, blocked: { igst: 0, cgst: 0, sgst: 0, cess: 0 } }, rcmInward: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 } },
      COMPANY_GSTIN, PERIOD
    )
    expect(r.zeroRated.taxable).toBe(500000)
    expect(r.nilExempt.taxable).toBe(0)
  })
})

// ---------- F1 regression: outward reverse-charge tax stays out of 3B liability ----------

describe('outward RCM (rchrg) in GSTR-3B (F1 #2)', () => {
  const rcmSale: GstDoc = {
    voucherId: 80, kind: 'sales', date: '2026-07-21', number: 'GTA-1',
    partyName: 'Registered Recipient', partyGstin: CTIN_29, pos: '29', invoiceValue: 105000,
    items: [{ rate: 5, taxable: 100000, cgst: 0, sgst: 0, igst: 5000, cess: 0 }],
    hsnLines: [{ hsn: '9965', description: 'Transport', uqc: 'OTH', qtyMilli: 0, rate: 5, taxable: 100000, cgst: 0, sgst: 0, igst: 5000, cess: 0 }],
    nilLines: [], invTyp: 'R', rchrg: true, validation: zeroValidation
  }
  const emptyItc = { impg: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, isrc: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, oth: { igst: 0, cgst: 0, sgst: 0, cess: 0 }, blocked: { igst: 0, cgst: 0, sgst: 0, cess: 0 } }

  it('3.1(a) keeps the taxable value but the recipient-payable tax never enters osup_det or netPayable', () => {
    const r = buildGstr3b(
      { docs: [rcmSale], itc: emptyItc, rcmInward: { taxable: 0, igst: 0, cgst: 0, sgst: 0, cess: 0 } },
      COMPANY_GSTIN, PERIOD
    )
    expect(r.outward.taxable).toBe(100000)
    expect(r.outward.igst).toBe(0) // recipient pays via their 3.1(d) — not this supplier
    expect(r.netPayable).toEqual({ igst: 0, cgst: 0, sgst: 0, cess: 0 })
    const sup = jsonAt(r.json, 'sup_details', 'osup_det')
    expect(sup).toEqual({ txval: 1000, iamt: 0, camt: 0, samt: 0, csamt: 0 })
  })

  it('GSTR-1 still reports the invoice with rchrg Y and its tax (recipient-side visibility)', () => {
    const json = buildGstr1([rcmSale], COMPANY_GSTIN, COMPANY_STATE, PERIOD).json
    expect(jsonAt(json, 'b2b', 0, 'inv', 0, 'rchrg')).toBe('Y')
    expect(jsonAt(json, 'b2b', 0, 'inv', 0, 'itms', 0, 'itm_det')).toMatchObject({ rt: 5, txval: 1000, iamt: 50 })
  })
})

// ---------- F1 regression: summary/CSV must not double-count rate-0 lines ----------

describe('GSTR-1 summary rate-0 double-count (F1 minor)', () => {
  it('a mixed B2B invoice splits cleanly: rated value on the b2b row, rate-0 value only on the nil row', () => {
    const mixed: GstDoc = {
      voucherId: 70, kind: 'sales', date: '2026-07-22', number: 'MIX-1',
      partyName: 'Umbrella Retail', partyGstin: CTIN_1, pos: '27', invoiceValue: 6900000,
      items: [
        { rate: 18, taxable: 5000000, cgst: 450000, sgst: 450000, igst: 0, cess: 0 },
        { rate: 0, taxable: 1000000, cgst: 0, sgst: 0, igst: 0, cess: 0 }
      ],
      hsnLines: [], nilLines: [], invTyp: 'R', rchrg: false, validation: zeroValidation
    }
    const r = buildGstr1([mixed], COMPANY_GSTIN, COMPANY_STATE, PERIOD)
    expect(r.summary.find((s) => s.section === 'b2b')).toMatchObject({ taxable: 5000000 })
    expect(r.summary.find((s) => s.section === 'nil')).toMatchObject({ taxable: 1000000 })
    // JSON agrees: the rt-0 line reaches Table 8, not the b2b itms.
    const json = r.json
    expect(jsonAt(json, 'b2b', 0, 'inv', 0, 'itms')).toHaveLength(1)
    expect(jsonAt(json, 'nil', 'inv')).toEqual([{ sply_ty: 'INTRAB2B', nil_amt: 10000, expt_amt: 0, ngsup_amt: 0 }])
  })
})

// ---------- F1 regression: Rule-35 advance back-out ----------

describe('backOutAdvance (Rule 35 — advances are tax-inclusive)', () => {
  it('₹1,18,000 received at 18% intra is ₹1,00,000 taxable + ₹9,000 CGST + ₹9,000 SGST', () => {
    expect(backOutAdvance(11800000, 18, 'intra')).toEqual({
      taxable: 10000000, cgst: 900000, sgst: 900000, igst: 0, cess: 0, total: 11800000
    })
  })
  it('inter-state puts the whole residue in IGST', () => {
    expect(backOutAdvance(11800000, 18, 'inter')).toEqual({
      taxable: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0, total: 11800000
    })
  })
  it('taxable + tax always reconstructs the gross exactly (odd paise)', () => {
    const g = backOutAdvance(101, 18, 'intra')
    expect(g.taxable + g.cgst + g.sgst).toBe(101)
    // half-away rounding: 101×100/118 = 85.59… → 86; tax 15 → cgst 8 (7.5 half-away), sgst 7
    expect(g).toEqual({ taxable: 86, cgst: 8, sgst: 7, igst: 0, cess: 0, total: 101 })
    const i = backOutAdvance(101, 18, 'inter')
    expect(i.taxable + i.igst).toBe(101)
  })
  it('rate 0 backs out nothing', () => {
    expect(backOutAdvance(5000, 0, 'intra')).toEqual({ taxable: 5000, cgst: 0, sgst: 0, igst: 0, cess: 0, total: 5000 })
  })
})

// ---------- e-way bill ----------

const ewbCompany: EdocCompany = {
  name: 'Demo Traders',
  gstin: COMPANY_GSTIN,
  stateCode: '27',
  address: '12 MG Road, Pune 411001'
}

function ewbInvoice(): EdocInvoice {
  return {
    number: 'INV-2',
    date: '2026-07-06',
    docType: 'INV',
    partyName: 'Cash buyer',
    partyGstin: null,
    partyAddress: '5 Brigade Rd, Bengaluru 560001',
    partyStateCode: '29',
    pos: '29',
    items: [{
      name: 'Laptop 14', hsn: '8471', qtyMilli: 2000, uqc: 'PCS', unitPricePaise: 5000000,
      taxablePaise: 10000000, rate: 18, cessRate: 0, cgst: 0, sgst: 0, igst: 1800000, cess: 0, isService: false
    }],
    taxable: 10000000, cgst: 0, sgst: 0, igst: 1800000, cess: 0, roundOff: 0, total: 11800000,
    transporterId: '29AACCR7832C1ZD', vehicleNo: 'KA01AB1234', distanceKm: 350,
    transport: { mode: '1', docNo: 'LR-9', docDate: '2026-07-06', transporterName: 'VRL Logistics', vehicleType: 'R' },
    shipTo: { name: 'Cash buyer Whitefield', gstin: null, addr1: 'Plot 9, ITPL', addr2: 'Whitefield', place: 'Bengaluru', pincode: '560066', state: '29' }
  }
}

describe('e-way bill golden fixture', () => {
  it('single-bill JSON carries every mandatory field (fromPlace/toPlace/transactionType/…)', () => {
    expect(buildEwbJson([ewbInvoice()], ewbCompany)).toEqual(fixture('ewb-golden.json'))
  })

  it('transactionType is 1 (regular) without a ship-to block, 2 with one', () => {
    const plain = { ...ewbInvoice(), shipTo: null }
    expect(singleEwbBill(buildEwbJson([plain], ewbCompany)).transactionType).toBe(1)
    expect(singleEwbBill(buildEwbJson([ewbInvoice()], ewbCompany)).transactionType).toBe(2)
  })

  it('rates come from the item master rate, not back-derived from rounded tax (D9)', () => {
    const tiny = ewbInvoice()
    // 1 paisa taxable at 18% inter — igst rounds to 0 but the rate must survive
    tiny.items[0]! .taxablePaise = 1
    tiny.items[0]!.igst = 0
    const bill = singleEwbBill(buildEwbJson([tiny], ewbCompany))
    expect(bill.itemList[0]?.igstRate).toBe(18)
    expect(bill.itemList[0]?.cgstRate).toBe(0)
  })

  it('maps GST state 96/97 to EWB 99 (Other Country) for export buyers', () => {
    const exp: EdocInvoice = { ...ewbInvoice(), supTyp: 'EXPWP', partyStateCode: '96', pos: '96', shipTo: null, partyAddress: null }
    const bill = singleEwbBill(buildEwbJson([exp], ewbCompany))
    expect(bill.toStateCode).toBe(99)
    expect(bill.actualToStateCode).toBe(99)
    expect(bill.toGstin).toBe('URP')
    expect(bill.toPincode).toBe(999999)
  })

  it('flags missing 6-digit pincodes and places as blocking issues (no silent 0)', () => {
    const bad = { ...ewbInvoice(), shipTo: null, partyAddress: 'Somewhere vague' }
    const issues = ewbIssues(bad, ewbCompany)
    expect(issues.some((i) => i.includes('PIN'))).toBe(true)
    expect(ewbIssues(ewbInvoice(), ewbCompany)).toEqual([])
  })

  it('eligibility: services-only and ≤ ₹50,000 invoices are excluded with reasons', () => {
    expect(EWB_THRESHOLD_PAISE).toBe(5000000)
    const svc = ewbInvoice()
    svc.items = [{ ...svc.items[0]!, isService: true, qtyMilli: 0 }]
    expect(ewbEligibility(svc).eligible).toBe(false)
    expect(ewbEligibility(svc).reason).toMatch(/Services only/)

    const small = { ...ewbInvoice(), total: 4000000 }
    expect(ewbEligibility(small).eligible).toBe(false)
    expect(ewbEligibility(small, true).eligible).toBe(true)
    expect(ewbEligibility(ewbInvoice()).eligible).toBe(true)
  })
})

describe('splitAddress heuristic', () => {
  it('extracts addr1/addr2/place from comma- and newline-separated addresses', () => {
    expect(splitAddress('12 MG Road, Pune 411001')).toEqual({ addr1: '12 MG Road', addr2: '', place: 'Pune' })
    expect(splitAddress('Plot 4, Industrial Estate, Nashik 422001')).toEqual({ addr1: 'Plot 4', addr2: 'Industrial Estate', place: 'Nashik' })
    expect(splitAddress('12 MG Road\nShivaji Nagar\nPune 411005')).toEqual({ addr1: '12 MG Road', addr2: 'Shivaji Nagar', place: 'Pune' })
    expect(splitAddress(null)).toEqual({ addr1: '', addr2: '', place: '' })
    expect(splitAddress('Just one line')).toEqual({ addr1: 'Just one line', addr2: '', place: '' })
  })
})

// ---------- e-invoice ----------

describe('e-invoice — export, service and note details (G6)', () => {
  it('emits a mandatory ExpDtls block for exports, with shipping bill from transport details', () => {
    const exp: EdocInvoice = {
      ...ewbInvoice(), supTyp: 'EXPWP', partyStateCode: '96', pos: '96',
      transport: { mode: '3', docNo: 'SB-77', docDate: '2026-07-10', transporterName: null, vehicleType: null },
      shipTo: null
    }
    const doc = singleEinvoiceDoc(buildEInvoiceJson([exp], ewbCompany))
    // WP 3.5: uncaptured Port/ForCur/CntCode are omitted, not null (the IRN schema types them as strings).
    expect(doc.ExpDtls).toEqual({ ShipBNo: 'SB-77', ShipBDt: '10/07/2026' })
    expect(doc.BuyerDtls.Stcd).toBe('96')
    expect(doc.BuyerDtls.Pin).toBe(999999)
    expect(doc.BuyerDtls.Pos).toBe('96')
    expect(doc.BuyerDtls.Gstin).toBe('URP')
  })

  it('non-export invoices carry no ExpDtls', () => {
    const doc = singleEinvoiceDoc(buildEInvoiceJson([ewbInvoice()], ewbCompany))
    expect(doc.ExpDtls).toBeUndefined()
  })

  it('service items get IsServc Y, qty 1, unit OTH and a non-empty ItemList', () => {
    const svc = ewbInvoice()
    svc.items = [{
      name: 'Consulting', hsn: '9983', qtyMilli: 0, uqc: 'OTH', unitPricePaise: 0,
      taxablePaise: 250000, rate: 18, cessRate: 0, cgst: 22500, sgst: 22500, igst: 0, cess: 0, isService: true
    }]
    const doc = singleEinvoiceDoc(buildEInvoiceJson([svc], ewbCompany))
    expect(doc.ItemList).toHaveLength(1)
    expect(doc.ItemList[0]).toMatchObject({ IsServc: 'Y', HsnCd: '9983', Qty: 1, Unit: 'OTH', UnitPrice: 2500, AssAmt: 2500 })
  })

  it('CRN/DBN carry RefDtls.PrecDocDtls when the original invoice resolves (null-safe otherwise)', () => {
    const crn: EdocInvoice = { ...ewbInvoice(), docType: 'CRN', precedingDoc: { invNo: 'INV-2', invDate: '2026-07-06' } }
    const doc = singleEinvoiceDoc(buildEInvoiceJson([crn], ewbCompany))
    expect(doc.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: 'INV-2', InvDt: '06/07/2026' }] })

    const orphan: EdocInvoice = { ...ewbInvoice(), docType: 'CRN', precedingDoc: null }
    const doc2 = singleEinvoiceDoc(buildEInvoiceJson([orphan], ewbCompany))
    expect(doc2.RefDtls).toBeUndefined()
  })

  it('ship-to block becomes ShipDtls', () => {
    const doc = singleEinvoiceDoc(buildEInvoiceJson([ewbInvoice()], ewbCompany))
    expect(doc.ShipDtls).toMatchObject({ LglNm: 'Cash buyer Whitefield', Addr1: 'Plot 9, ITPL', Loc: 'Bengaluru', Pin: 560066, Stcd: '29' })
  })

  it('TranDtls.RegRev is Y for reverse-charge invoices, N otherwise', () => {
    const plain = singleEinvoiceDoc(buildEInvoiceJson([ewbInvoice()], ewbCompany))
    expect(plain.TranDtls.RegRev).toBe('N')
    const rcm = singleEinvoiceDoc(buildEInvoiceJson([{ ...ewbInvoice(), rchrg: true }], ewbCompany))
    expect(rcm.TranDtls.RegRev).toBe('Y')
  })

  it('SEZ e-way bills use IGST rates even when the SEZ unit is in the company state', () => {
    const sez: EdocInvoice = { ...ewbInvoice(), supTyp: 'SEZWP', partyStateCode: '27', pos: '27', shipTo: null }
    const bill = singleEwbBill(buildEwbJson([sez], ewbCompany))
    expect(bill.itemList[0]?.igstRate).toBe(18)
    expect(bill.itemList[0]?.cgstRate).toBe(0)
    expect(bill.itemList[0]?.sgstRate).toBe(0)
  })
})

// ---------- UQC ----------

describe('UQC master + mapper', () => {
  it('contains the CBIC codes (LTR included — it IS on the published master)', () => {
    for (const code of ['NOS', 'PCS', 'KGS', 'LTR', 'MTR', 'BOX', 'OTH', 'SET', 'TON']) {
      expect(isUqc(code), `${code} should be a valid UQC`).toBe(true)
    }
    expect(Object.keys(UQC_CODES).length).toBeGreaterThanOrEqual(40)
  })
  it('maps aliases and falls back to OTH with a warning flag', () => {
    expect(toUqc('L')).toEqual({ uqc: 'LTR', fallback: false })
    expect(toUqc('kg')).toEqual({ uqc: 'KGS', fallback: false })
    expect(toUqc('Pc')).toEqual({ uqc: 'PCS', fallback: false })
    expect(toUqc('LTR')).toEqual({ uqc: 'LTR', fallback: false })
    expect(toUqc('gobbledygook')).toEqual({ uqc: 'OTH', fallback: true })
  })
})

// ---------- validation panel (G7) ----------

describe('validateGstr1', () => {
  const company = { stateCode: '27', gstin: COMPANY_GSTIN, gstRegistrationType: 'regular' as const }

  it('a clean fixture book yields no blocking issues', () => {
    const issues = validateGstr1(fixtureDocs(), company)
    expect(issues.filter((i) => i.severity === 'blocking')).toEqual([])
  })

  it('missing HSN lines block with count + voucher list', () => {
    const docs = fixtureDocs()
    docs[0]!.validation = { ...zeroValidation, missingHsnCount: 2 }
    const issues = validateGstr1(docs, company)
    const issue = issues.find((i) => i.code === 'missing_hsn')!
    expect(issue.severity).toBe('blocking')
    expect(issue.voucherIds).toEqual([1])
    expect(issue.message).toContain('2 lines')
  })

  it('WP 2.5b: an e-invoicing company is warned (never blocked) about sales numbers the IRP refuses (DocDtls.No)', () => {
    const docs = fixtureDocs()
    const sale = docs.find((d) => d.kind === 'sales')!
    sale.number = 'INV/2026-27/000001' // 18 characters
    expect(validateGstr1(docs, company).find((i) => i.code === 'einvoice_doc_no')).toBeUndefined() // not e-invoicing
    const issue = validateGstr1(docs, { ...company, einvoicing: true }).find((i) => i.code === 'einvoice_doc_no')!
    expect(issue.severity).toBe('warning')
    expect(issue.voucherIds).toEqual([sale.voucherId])
    expect(issue.message).toContain('INV/2026-27/000001')
    expect(issue.message).toContain('DocDtls.No')
    sale.number = 'INV 7'
    expect(validateGstr1(docs, { ...company, einvoicing: true }).find((i) => i.code === 'einvoice_doc_no')?.voucherIds).toEqual([sale.voucherId])
    sale.number = 'INV/26-27/000001' // exactly 16
    expect(validateGstr1(docs, { ...company, einvoicing: true }).find((i) => i.code === 'einvoice_doc_no')).toBeUndefined()
    sale.number = 'INV/2026-27/000001'
    expect(validateGstr1(docs, { ...company, gstRegistrationType: 'composition', einvoicing: true }).find((i) => i.code === 'einvoice_doc_no')).toBeUndefined()
  })

  it('PR #140 review: credit notes are checked too (DocDtls.Typ CRN, same No rule); B2C bills are not e-invoiced', () => {
    const docs = fixtureDocs()
    const b2c = docs.find((d) => d.kind === 'sales' && !d.partyGstin)!
    b2c.number = 'B2C/2026-27/000001'
    expect(validateGstr1(docs, { ...company, einvoicing: true }).find((i) => i.code === 'einvoice_doc_no')).toBeUndefined()
    const note = docs.find((d) => d.kind === 'credit_note' && d.partyGstin)!
    note.number = 'CRN/2026-27/000001'
    const issue = validateGstr1(docs, { ...company, einvoicing: true }).find((i) => i.code === 'einvoice_doc_no')!
    expect(issue.voucherIds).toEqual([note.voucherId])
    expect(issue.message).toContain('1 invoice / note')
  })

  it('invalid buyer GSTINs block', () => {
    const docs = fixtureDocs()
    docs[0]!.partyGstin = '27AAPFU0939F1ZZ' // bad checksum
    const issues = validateGstr1(docs, company)
    expect(issues.find((i) => i.code === 'invalid_gstin')?.severity).toBe('blocking')
  })

  it('invalid UQC blocks', () => {
    const docs = fixtureDocs()
    docs[0]!.hsnLines[0]!.uqc = 'BANANAS'
    expect(validateGstr1(docs, company).find((i) => i.code === 'invalid_uqc')?.severity).toBe('blocking')
  })

  it('booked-vs-computed value mismatch beyond ₹1 blocks; within ₹1 passes (round-off)', () => {
    const docs = fixtureDocs()
    docs[0]!.validation = { ...zeroValidation, valDiff: 150 }
    expect(validateGstr1(docs, company).find((i) => i.code === 'val_mismatch')?.severity).toBe('blocking')
    docs[0]!.validation = { ...zeroValidation, valDiff: 99 }
    expect(validateGstr1(docs, company).find((i) => i.code === 'val_mismatch')).toBeUndefined()
  })

  it('duplicate invoice numbers in the period block', () => {
    const docs = fixtureDocs()
    docs[1]!.number = 'INV-1'
    const issue = validateGstr1(docs, company).find((i) => i.code === 'duplicate_number')!
    expect(issue.severity).toBe('blocking')
    expect(issue.voucherIds).toContain(1)
    expect(issue.voucherIds).toContain(2)
  })

  it('composition companies are blocked from GSTR-1 with an explanation', () => {
    const issue = validateGstr1(fixtureDocs(), { ...company, gstRegistrationType: 'composition' })
      .find((i) => i.code === 'composition')!
    expect(issue.severity).toBe('blocking')
    expect(issue.message).toContain('CMP-08')
  })

  it('R3: a period with no registration on any day is blocked too (no GSTR-1 is due)', () => {
    const issue = validateGstr1(fixtureDocs(), { ...company, gstRegistrationType: 'unregistered' }).find((i) => i.code === 'not_registered')!
    expect(issue).toMatchObject({ severity: 'blocking', voucherIds: [] })
    expect(issue.message).toBe('The company was not registered for GST on any day of this period, so no GSTR-1 is due for it.')
    expect(validateGstr1(fixtureDocs(), company).some((i) => i.code === 'not_registered' || i.code === 'composition')).toBe(false)
  })

  it('R3: notRegularDaysIssue names the documents of a changed month’s non-regular days, nothing else', () => {
    const docs = [{ voucherId: 1, date: '2026-10-05' }, { voucherId: 2, date: '2026-10-14' }, { voucherId: 3, date: '2026-10-15' }]
    const movedIn = { gstRegistrationType: 'regular' as const, gstRegistrationSince: '2026-10-15', gstPreviousRegistrationType: 'composition' as const }
    const issue = notRegularDaysIssue(docs, movedIn)!
    expect(issue).toMatchObject({ code: 'not_regular_days', severity: 'warning', voucherIds: [1, 2] })
    expect(issue.message).toBe(
      '2 documents are dated on days the company was under the composition scheme (the registration changed on 15-Oct-26). ' +
        'They appear in this return at 0 %, but only the regular days belong in GSTR-1 / GSTR-3B (s.37(1), s.39(1) CGST Act); ' +
        'the composition days go in CMP-08 and GSTR-4 (rule 62 CGST Rules). Check with your CA before you upload this period’s file.'
    )
    // Cancelled from 15 Oct: the later days are not registered.
    const cancelled = { gstRegistrationType: 'unregistered' as const, gstRegistrationSince: '2026-10-15', gstPreviousRegistrationType: 'regular' as const }
    expect(notRegularDaysIssue(docs, cancelled)?.message).toMatch(/^1 document is dated on days the company was not registered for GST .*CGST Act\)\. Check with your CA/)
    expect(notRegularDaysIssue(docs, { gstRegistrationType: 'regular' })).toBeNull()
  })

  it('CGST/SGST on a zero-rated (SEZ/export) document blocks — legacy intra-taxed SEZ data cannot slip through', () => {
    const docs = fixtureDocs()
    // Simulate a doc extracted BEFORE the SEZ-inter fix: same-state SEZ carrying CGST/SGST.
    docs.push({
      voucherId: 99, kind: 'sales', date: '2026-07-19', number: 'SEZ-BAD',
      partyName: 'SEZ Unit One', partyGstin: CTIN_SEZ, pos: '27', invoiceValue: 118000,
      items: [{ rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }],
      hsnLines: [{ hsn: '9983', description: 'Consulting SEZ', uqc: 'OTH', qtyMilli: 0, rate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0, cess: 0 }],
      nilLines: [], invTyp: 'SEWP', rchrg: false, validation: zeroValidation
    })
    const issue = validateGstr1(docs, company).find((i) => i.code === 'zero_rated_intra_tax')!
    expect(issue.severity).toBe('blocking')
    expect(issue.voucherIds).toEqual([99])
    expect(issue.message).toMatch(/IGST/)
  })

  it('rate-0 lines and B2CL threshold edges warn (not block)', () => {
    const docs = fixtureDocs()
    docs[1]!.invoiceValue = B2CL_THRESHOLD_PAISE // exactly at the limit → B2CS, warn
    const issues = validateGstr1(docs, company)
    expect(issues.find((i) => i.code === 'rate_zero_untyped')?.severity).toBe('warning')
    expect(issues.find((i) => i.code === 'b2cl_edge')?.severity).toBe('warning')
  })
})

// Bug hunt 2026-11: GSTN's CDNUR help (tutorial.gst.gov.in/contextualhelp/Einv/CDNUR.htm) lists the
// notes "issued in respect of" B2C Large invoices and exports — the ORIGINAL invoice decides.
describe('9B CDNUR follows the original invoice', () => {
  const zero = zeroValidation
  const note = (over: Partial<GstDoc>): GstDoc => ({
    voucherId: 91, kind: 'credit_note', date: '2026-07-20', number: 'CRN-9',
    partyName: 'Walk-in', partyGstin: null, pos: '29', invoiceValue: 2_360_000,
    items: [{ rate: 18, taxable: 2_000_000, cgst: 0, sgst: 0, igst: 360_000, cess: 0 }],
    hsnLines: [], nilLines: [], invTyp: 'R', rchrg: false, validation: zero, ...over
  })
  it('a small note against a B2C Large invoice goes to CDNUR (typ B2CL)', () => {
    const r = buildGstr1([note({ original: { invoiceValue: 17_700_000, pos: '29', date: '2026-07-01' } })], COMPANY_GSTIN, COMPANY_STATE, PERIOD)
    expect((r.json.cdnur as { nt_num: string; typ: string }[] | undefined)?.map((n) => [n.nt_num, n.typ])).toEqual([['CRN-9', 'B2CL']])
    expect(r.json.b2cs ?? []).toEqual([])
  })
  it('a large debit note against a B2C Small invoice nets into B2CS, never CDNUR', () => {
    const r = buildGstr1(
      [note({ kind: 'debit_note', invoiceValue: 11_800_000, items: [{ rate: 18, taxable: 10_000_000, cgst: 0, sgst: 0, igst: 1_800_000, cess: 0 }], original: { invoiceValue: 59_000, pos: '29', date: '2026-07-01' } })],
      COMPANY_GSTIN, COMPANY_STATE, PERIOD
    )
    expect(r.json.cdnur ?? []).toEqual([])
    expect((r.json.b2cs as unknown[] | undefined)?.length).toBe(1)
  })
  it('without a known original the note is judged by its own value, as before', () => {
    const r = buildGstr1([note({ invoiceValue: 11_800_000 })], COMPANY_GSTIN, COMPANY_STATE, PERIOD)
    expect((r.json.cdnur as unknown[] | undefined)?.length).toBe(1)
  })
})

// Third review of #187: the B2CL limit is the one in force on the INVOICE's date — ₹2,50,000 before
// 1 Aug 2024, ₹1,00,000 from then (Notification 12/2024–Central Tax).
describe('B2CL limit by date', () => {
  const zero = zeroValidation
  const inv = (date: string, value: number): GstDoc => ({
    voucherId: 81, kind: 'sales', date, number: 'S-81', partyName: 'Walk-in', partyGstin: null, pos: '29', invoiceValue: value,
    items: [{ rate: 18, taxable: Math.round(value / 1.18), cgst: 0, sgst: 0, igst: value - Math.round(value / 1.18), cess: 0 }],
    hsnLines: [], nilLines: [], invTyp: 'R', rchrg: false, validation: zero
  })
  it('b2clLimitOn', () => {
    expect(b2clLimitOn('2024-07-31')).toBe(25_000_000)
    expect(b2clLimitOn('2024-08-01')).toBe(10_000_000)
    expect(B2CL_THRESHOLD_PAISE).toBe(10_000_000)
  })
  it('an inter-state ₹2,12,400 invoice of July 2024 is B2CS; of August 2024 B2CL', () => {
    const july = buildGstr1([inv('2024-07-10', 21_240_000)], COMPANY_GSTIN, COMPANY_STATE, '072024')
    expect(july.json.b2cl ?? []).toEqual([])
    expect((july.json.b2cs as unknown[] | undefined)?.length).toBe(1)
    const aug = buildGstr1([inv('2024-08-10', 21_240_000)], COMPANY_GSTIN, COMPANY_STATE, '082024')
    expect((aug.json.b2cl as unknown[] | undefined)?.length).toBe(1)
  })
  it('at the limit itself an invoice stays B2CS ("exceeds"), on both sides of 1 Aug 2024', () => {
    const b2cl = (date: string, value: number, period: string) =>
      ((buildGstr1([inv(date, value)], COMPANY_GSTIN, COMPANY_STATE, period).json.b2cl ?? []) as unknown[]).length
    expect(b2cl('2024-07-31', 25_000_000, '072024')).toBe(0)
    expect(b2cl('2024-07-31', 25_000_100, '072024')).toBe(1)
    expect(b2cl('2024-08-01', 10_000_000, '082024')).toBe(0)
    expect(b2cl('2024-08-01', 10_000_100, '082024')).toBe(1)
  })
  it('the B2C (Large) label for a month names the limit then: ₹2,50,000 before Aug 2024; buildGstr1 keeps its pinned label', () => {
    expect(b2clLabelForPeriod('072024')).toBe('B2C (Large) — inter-state > ₹2,50,000')
    expect(b2clLabelForPeriod('042017')).toBe('B2C (Large) — inter-state > ₹2,50,000')
    expect(b2clLabelForPeriod('082024')).toBe('B2C (Large) — inter-state > ₹1,00,000')
    expect(b2clLabelForPeriod('082025')).toBe(B2CL_SUMMARY_LABEL)
    expect(b2clLabelForPeriod('')).toBe(B2CL_SUMMARY_LABEL)
    // The service output is unchanged for every period (hashes / fixtures pin it).
    const july = buildGstr1([inv('2024-07-10', 30_000_000)], COMPANY_GSTIN, COMPANY_STATE, '072024')
    expect(july.summary.find((r) => r.section === 'b2cl')!.label).toBe('B2C (Large) — inter-state > ₹1,00,000')
  })
  it('a note is judged by the limit on its ORIGINAL\'s date', () => {
    const n: GstDoc = {
      ...inv('2024-09-10', 1_180_000), voucherId: 82, kind: 'credit_note', number: 'CN-82',
      items: [{ rate: 18, taxable: 1_000_000, cgst: 0, sgst: 0, igst: 180_000, cess: 0 }],
      original: { invoiceValue: 21_240_000, pos: '29', date: '2024-07-10' }
    }
    expect(buildGstr1([n], COMPANY_GSTIN, COMPANY_STATE, '092024').json.cdnur ?? []).toEqual([])
    expect(((buildGstr1([{ ...n, original: { ...n.original!, date: '2024-08-10' } }], COMPANY_GSTIN, COMPANY_STATE, '092024').json.cdnur ?? []) as unknown[]).length).toBe(1)
  })
})
