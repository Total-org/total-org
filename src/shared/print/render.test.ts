import { describe, expect, it } from 'vitest'
import type { CompanyInfo } from '../domain'
import type { EdocInvoice, EdocItem } from '../gst/edocs'
import { DEFAULT_INVOICE_CONFIG, type InvoiceConfig } from '../invoiceConfig'
import { amountInWords, formatPaise } from '../money'
import {
  BUILT_IN_DEFAULTS,
  CLASSIC_DEFAULT,
  COMPACT_DEFAULT,
  legacyConfigToTemplate,
  MODERN_DEFAULT,
  RECEIPT_58MM_CHARS,
  RECEIPT_58MM_DEFAULT,
  RECEIPT_80MM_DEFAULT,
  pdfOptionsFor,
  printTemplateSchema,
  rollHeightMm,
  type PrintTemplate
} from '../printTemplates'
import { legacyBuildInvoiceHtml } from './legacyInvoiceHtml.fixture'
import { normaliseHtml, receiptQrMm, renderDocument, type InvoiceDocument } from './render'
import { sampleDocument } from './sample'
import { taxSummaryForInvoice } from './taxSummary'

const COMPANY: CompanyInfo = {
  name: 'Total Traders',
  stateCode: '27',
  gstin: '27AAAAA0000A1Z5',
  gstRegistrationType: 'regular',
  address: '1 Market Road, Mumbai',
  booksFrom: 2025,
  email: 'accounts@total.example',
  phone: '+91 22 4000 1234',
  pan: 'AAAAA0000A',
  tan: null
}

const BASE_ITEM: EdocItem = {
  name: 'Sample product', hsn: '8471', qtyMilli: 2000, uqc: 'NOS',
  unitPricePaise: 500000, taxablePaise: 1000000, rate: 18, cessRate: 0,
  cgst: 90000, sgst: 90000, igst: 0, cess: 0, isService: false, barcode: 'SAMPLE-BC-001'
}
const item = (o: Partial<EdocItem>): EdocItem => ({ ...BASE_ITEM, ...o })

const INV: EdocInvoice = {
  number: 'SAMPLE-1', date: '2025-04-01', partyName: 'Sample Buyer Pvt Ltd', partyGstin: '27AAAAA0000A1Z5',
  partyAddress: '123 Sample Street, Sample City', partyStateCode: '27', pos: '27', items: [BASE_ITEM],
  taxable: 1000000, cgst: 90000, sgst: 90000, igst: 0, cess: 0, roundOff: 0, total: 1180000,
  transporterId: null, vehicleNo: null, distanceKm: null, irn: null
}

const doc = (invoice: EdocInvoice, audit?: InvoiceDocument['audit']): InvoiceDocument => ({
  shape: 'invoice', kind: 'sales', company: COMPANY, invoice, audit
})

// ---------------------------------------------------------------- Classic ≡ legacy

const CONFIGS: [string, InvoiceConfig][] = [
  ['defaults', DEFAULT_INVOICE_CONFIG],
  ['logo + bank + terms', {
    ...DEFAULT_INVOICE_CONFIG,
    title: 'INVOICE', logoDataUrl: 'data:image/png;base64,aGVsbG8=',
    bankDetails: { name: 'Total Bank', account: '12345', ifsc: 'TOTL0001', branch: 'HQ' },
    terms: 'Payment due in 30 days\nInterest @18% after due date', signatory: 'Director'
  }],
  ['no HSN, discount, barcode, no QR', { ...DEFAULT_INVOICE_CONFIG, showHsn: false, showDiscount: true, showItemBarcode: true, showQr: false }],
  ['three copies + entered-by', { ...DEFAULT_INVOICE_CONFIG, copyLabels: ['Original for Recipient', 'Duplicate for Transporter', 'Triplicate for Supplier'], showEnteredBy: true }],
  ['empty declaration', { ...DEFAULT_INVOICE_CONFIG, declaration: '' }]
]

const INVOICES: [string, EdocInvoice][] = [
  ['single line', INV],
  ['tricky text + vehicle + round-off', { ...INV, partyName: `Sam's "Best" <India>`, vehicleNo: 'MH01AB1234', roundOff: -42, total: 1179958 }],
  ['inter-state, cess, discount, no-HSN line', {
    ...INV, partyStateCode: '29', pos: '29', cgst: 0, sgst: 0, igst: 180000 + 36000, cess: 12000,
    items: [item({ cgst: 0, sgst: 0, igst: 180000, discountPaise: 5000 }), item({ hsn: '', rate: 12, cgst: 0, sgst: 0, igst: 36000, cess: 12000, cessRate: 4, barcode: null })]
  }],
  ['long (20 lines, carried forward)', { ...INV, items: Array.from({ length: 20 }, (_, i) => item({ name: `Line ${i + 1}`, taxablePaise: 1000 })) }],
  ['zero-rated inter-state', { ...INV, partyStateCode: '29', pos: '29', cgst: 0, sgst: 0, igst: 0, total: 1000000, items: [item({ rate: 0, cgst: 0, sgst: 0 })] }],
  ['with IRN (QR carries it)', { ...INV, irn: 'abc123' }]
]

describe('Classic template ≡ the pre-1.10c invoice renderer (whitespace-normalised)', () => {
  const audit = { enteredBy: 'Priya', alteredBy: 'Rahul' }
  for (const [cName, cfg] of CONFIGS) {
    for (const [iName, inv] of INVOICES) {
      it(`${cName} × ${iName}`, () => {
        const legacy = legacyBuildInvoiceHtml(COMPANY, cfg, inv, audit)
        let next = renderDocument(legacyConfigToTemplate(cfg), doc(inv, audit))
        if (inv.irn) {
          // The ONE intended addition (WP 1.10c item 5): an e-invoiced voucher now prints its IRN
          // line. Prove it is the only difference: strip that block + its rule, then compare.
          expect(next).toContain('<div class="einv">IRN: <span class="num">abc123</span></div>')
          next = next.replace(/<div class="einv">.*?<\/div>/g, '').replace(/\.einv \{[^}]*\}/, '')
        }
        expect(normaliseHtml(next)).toBe(normaliseHtml(legacy))
      })
    }
  }

  it('is in fact byte-different only in whitespace (sanity: the normaliser is not hiding content)', () => {
    const legacy = legacyBuildInvoiceHtml(COMPANY, DEFAULT_INVOICE_CONFIG, INV)
    const next = renderDocument(CLASSIC_DEFAULT, doc(INV))
    expect(next.replace(/\s+/g, '')).toBe(legacy.replace(/\s+/g, ''))
  })
})

// ---------------------------------------------------------------- built-in snapshots

describe('built-in templates on the sample invoice (snapshots)', () => {
  for (const t of Object.values(BUILT_IN_DEFAULTS)) {
    it(`${t.name} renders stably`, () => {
      expect(renderDocument(t, sampleDocument(COMPANY, 'sales'))).toMatchSnapshot()
    })
    it(`${t.name} renders a receipt voucher`, () => {
      const html = renderDocument(t, sampleDocument(COMPANY, 'receipt'))
      expect(html).toContain('RECEIPT')
      expect(html).toContain('Received from')
      // The thermal receipt (WP 2.6) prints no amount in words; it lays vouchers out compact.
      if (t.style !== 'receipt') expect(html).toContain(amountInWords(7500000))
    })
  }
})

// ---------------------------------------------------------------- specific assertions

const headers = (html: string): string[] => {
  const table = html.match(/<table class="items">([\s\S]*?)<\/thead>/)![1]!
  return [...table.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]!)
}
const withColumns = (t: PrintTemplate, mutate: (cols: PrintTemplate['columns']) => PrintTemplate['columns']): PrintTemplate =>
  printTemplateSchema.parse({ ...t, columns: mutate(t.columns.map((c) => ({ ...c }))) })

describe('renderDocument — template options', () => {
  it('prints columns in template order and omits hidden ones', () => {
    const t = withColumns(CLASSIC_DEFAULT, (cols) => {
      const rate = cols.findIndex((c) => c.key === 'rate')
      const qty = cols.findIndex((c) => c.key === 'qty')
      ;[cols[rate], cols[qty]] = [cols[qty]!, cols[rate]!]
      return cols.map((c) => (c.key === 'gstRate' ? { ...c, visible: false } : c))
    })
    const h = headers(renderDocument(t, doc(INV)))
    expect(h).toEqual(['#', 'Description', 'HSN', 'Rate', 'Qty', 'Amount'])
  })

  it('auto-hides CGST/SGST on inter-state and IGST on intra-state invoices', () => {
    const t = withColumns(CLASSIC_DEFAULT, (cols) => cols.map((c) => (['cgst', 'sgst', 'igst'].includes(c.key) ? { ...c, visible: true } : c)))
    expect(headers(renderDocument(t, doc(INV)))).toEqual(expect.arrayContaining(['CGST', 'SGST']))
    expect(headers(renderDocument(t, doc(INV)))).not.toContain('IGST')
    const inter = { ...INV, pos: '29', cgst: 0, sgst: 0, igst: 180000, items: [item({ cgst: 0, sgst: 0, igst: 180000 })] }
    expect(headers(renderDocument(t, doc(inter)))).toContain('IGST')
    expect(headers(renderDocument(t, doc(inter)))).not.toContain('CGST')
  })

  it('a separate Unit column takes the unit out of the Qty cell', () => {
    const t = withColumns(CLASSIC_DEFAULT, (cols) => cols.map((c) => (c.key === 'unit' ? { ...c, visible: true } : c)))
    const html = renderDocument(t, doc(INV))
    expect(html).toContain('<td class="r num">2</td>')
    expect(html).toContain('<td class="c">NOS</td>')
    expect(renderDocument(CLASSIC_DEFAULT, doc(INV))).toContain('<td class="r num">2 NOS</td>')
  })

  it('prints the amount in words with Indian numbering, and can hide it', () => {
    const big = { ...INV, total: 1234567800 }
    expect(renderDocument(CLASSIC_DEFAULT, doc(big))).toContain('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Rupees Only')
    const off = printTemplateSchema.parse({ ...CLASSIC_DEFAULT, totals: { ...CLASSIC_DEFAULT.totals, showAmountInWords: false } })
    expect(renderDocument(off, doc(big))).not.toContain('Amount in words')
  })

  it('tax summary by rate: rows sum to the line taxable/tax totals of the sample invoice', () => {
    const sample = sampleDocument(COMPANY, 'sales')
    if (sample.shape !== 'invoice') throw new Error('expected invoice')
    const inv = sample.invoice
    const rows = taxSummaryForInvoice(inv, 'rate', 'intra')
    expect(rows.map((r) => r.rate)).toEqual([12, 18, 18])
    const sum = (f: (r: (typeof rows)[number]) => number): number => rows.reduce((s, r) => s + f(r), 0)
    expect(sum((r) => r.taxable)).toBe(inv.taxable)
    expect(sum((r) => r.cgst)).toBe(inv.cgst)
    expect(sum((r) => r.sgst)).toBe(inv.sgst)
    expect(sum((r) => r.cess)).toBe(inv.cess)
    const html = renderDocument(MODERN_DEFAULT, sample)
    expect(html).toContain('<th>GST rate</th>')
    expect(html).toContain(formatPaise(inv.taxable))
  })

  it('emits @page size CSS for non-A4-portrait pages only', () => {
    expect(renderDocument(CLASSIC_DEFAULT, doc(INV))).not.toContain('@page')
    const a5 = printTemplateSchema.parse({ ...COMPACT_DEFAULT, page: { ...COMPACT_DEFAULT.page, size: 'A5', orientation: 'landscape' } })
    expect(renderDocument(a5, doc(INV))).toContain('@page { size: A5 landscape; }')
    const letter = printTemplateSchema.parse({ ...COMPACT_DEFAULT, page: { ...COMPACT_DEFAULT.page, size: 'Letter' } })
    expect(renderDocument(letter, doc(INV))).toContain('@page { size: letter portrait; }')
  })

  it('keeps header rows repeating and rows unsplit in every built-in style', () => {
    for (const t of Object.values(BUILT_IN_DEFAULTS)) {
      const html = renderDocument(t, doc(INV))
      expect(html).toContain('thead { display: table-header-group; }')
      expect(html).toContain('tr { page-break-inside: avoid; }')
    }
  })

  it('prints the e-invoice block (IRN, ack, e-way bill) when IRN data exists, and not otherwise', () => {
    const sample = sampleDocument(COMPANY, 'sales')
    const html = renderDocument(CLASSIC_DEFAULT, sample)
    expect(html).toContain('IRN: <span class="num">8f3c2a7d')
    expect(html).toContain('Ack No: <span class="num">112610000123456')
    expect(html).toContain('e-Way Bill No: <span class="num">321009876543')
    expect(html).toContain('Verification QR')
    expect(renderDocument(CLASSIC_DEFAULT, doc(INV))).not.toContain('class="einv"')
  })

  it('applies the accent, base font size, font family and date format', () => {
    const t = printTemplateSchema.parse({
      ...MODERN_DEFAULT,
      typography: { ...MODERN_DEFAULT.typography, accent: '#aa0033', baseFontPx: 9, fontFamily: 'plex-serif' },
      formats: { ...MODERN_DEFAULT.formats, date: 'dd/mm/yyyy' }
    })
    const html = renderDocument(t, doc(INV), { fontFaceCss: (f) => `@font-face { font-family: 'X-${f}'; }` })
    expect(html).toContain('border-bottom: 3px solid #aa0033')
    expect(html).toContain("font: 9px/1.5 'IBM Plex Serif'")
    expect(html).toContain("@font-face { font-family: 'X-plex-serif'; }")
    expect(html).not.toContain('X-plex-mono')
    expect(html).toContain('01/04/2025')
  })

  it('titles follow the document kind (credit notes no longer say TAX INVOICE)', () => {
    const cn: InvoiceDocument = { ...doc({ ...INV, docType: 'CRN', precedingDoc: { invNo: 'INV-9', invDate: '2025-03-01' } }), kind: 'credit_note' }
    const html = renderDocument(CLASSIC_DEFAULT, cn)
    expect(html).toContain('<b>CREDIT NOTE</b>')
    expect(html).toContain('Against: <span class="num">INV-9</span>')
    expect(html).not.toContain('TAX INVOICE')
  })

  it('outstanding balance and computer-generated note render only when enabled', () => {
    const t = printTemplateSchema.parse({
      ...CLASSIC_DEFAULT,
      totals: { ...CLASSIC_DEFAULT.totals, showOutstanding: true },
      footer: { ...CLASSIC_DEFAULT.footer, showComputerGenerated: true }
    })
    const html = renderDocument(t, { ...doc(INV), outstandingPaise: 250000 })
    expect(html).toContain('Balance outstanding</td><td class="r num">2,500.00 Dr')
    expect(html).toContain('This is a computer-generated document.')
    expect(renderDocument(CLASSIC_DEFAULT, { ...doc(INV), outstandingPaise: 250000 })).not.toContain('Balance outstanding')
  })

  it('TCS collected prints as "TCS @ rate u/s …" after GST, inside the total — only when the invoice carries it', () => {
    const withTcs: EdocInvoice = { ...INV, total: INV.total + 11800, tcs: { amountPaise: 11800, rateBp: 100, reference: '206C(1)' } }
    const html = renderDocument(CLASSIC_DEFAULT, doc(withTcs))
    expect(html).toContain('<tr><td>TCS @ 1% u/s 206C(1)</td><td class="r num">118.00</td></tr>')
    expect(html.indexOf('TCS @ 1%')).toBeGreaterThan(html.indexOf('<td>SGST</td>'))
    expect(html.indexOf('TCS @ 1%')).toBeLessThan(html.indexOf('<tr class="grand">'))
    expect(html).toContain('11,918.00')
    expect(renderDocument(CLASSIC_DEFAULT, doc(INV))).not.toContain('TCS')
  })

  it('escapes template text (no markup injection through labels)', () => {
    const t = withColumns(CLASSIC_DEFAULT, (cols) => cols.map((c) => (c.key === 'item' ? { ...c, label: '<b>x</b>' } : c)))
    expect(renderDocument(t, doc(INV))).toContain('<th>&lt;b&gt;x&lt;/b&gt;</th>')
  })

  // NIC follow-up: the IRP's SignedQRCode is the e-invoice QR — printed verbatim once stored.
  it('prints the IRP-signed QR (the stored SignedQRCode) instead of the Verification QR, only with a live IRN', () => {
    const irn = 'a'.repeat(64)
    // A JWS of the size the IRP returns (~1 KB) still fits a QR.
    const signedQr = `eyJhbGciOiJSUzI1NiJ9.${Buffer.from(JSON.stringify({ data: JSON.stringify({ Irn: irn, DocNo: 'SAMPLE-1', pad: 'x'.repeat(700) }), iss: 'NIC' })).toString('base64url')}.${'s'.repeat(342)}`
    const t = printTemplateSchema.parse({ ...CLASSIC_DEFAULT, einvoice: { ...CLASSIC_DEFAULT.einvoice, showQr: true } })
    const signed = renderDocument(t, { ...doc(INV), einvoice: { irn, ackNo: '1', ackDate: '2025-04-01', ewbNo: null, signedQr } })
    expect(signed).toContain('e-Invoice QR (signed by the IRP)')
    expect(signed).not.toContain('Verification QR')
    const unsigned = renderDocument(t, { ...doc(INV), einvoice: { irn, ackNo: '1', ackDate: '2025-04-01', ewbNo: null } })
    expect(unsigned).toContain('Verification QR')
    expect(unsigned).not.toContain('signed by the IRP')
    // No live IRN (cancelled = not passed): never the signed QR.
    expect(renderDocument(t, { ...doc(INV), einvoice: { irn: null, ackNo: null, ackDate: null, ewbNo: null, signedQr } })).toContain('Verification QR')
  })
})

// ---------------------------------------------------------------- A10: UPI pay QR
describe('UPI pay QR (A10)', () => {
  const upi = { link: 'upi://pay?pa=shop@ybl&pn=Total%20Traders&am=1180.00&tn=Bill%201&cu=INR', upiId: 'shop@ybl', amountPaise: 118000 }
  it('absent / null upi = byte-identical to a document without it, every built-in template', () => {
    for (const t of Object.values(BUILT_IN_DEFAULTS)) {
      const plain = renderDocument(t, doc(INV))
      expect(renderDocument(t, { ...doc(INV), upi: null })).toBe(plain)
      expect(plain).not.toContain('data-upi-qr')
    }
  })
  it('prints "Pay by UPI", the QR and who / how much when given', () => {
    for (const t of [CLASSIC_DEFAULT, MODERN_DEFAULT, COMPACT_DEFAULT, RECEIPT_80MM_DEFAULT]) {
      const html = renderDocument(t, { ...doc(INV), upi })
      expect(html).toContain('data-upi-qr')
      expect(html).toContain('Pay by UPI')
      expect(html).toContain(`Scan with any UPI app to pay ${formatPaise(118000, { symbol: true })} to shop@ybl`)
      expect((html.match(/<svg/g) ?? []).length).toBeGreaterThan((renderDocument(t, doc(INV)).match(/<svg/g) ?? []).length)
    }
  })
  it('never on a delivery challan / order (not an invoice)', () => {
    const html = renderDocument(CLASSIC_DEFAULT, { ...doc(INV), kind: 'delivery_challan', upi })
    expect(html).not.toContain('data-upi-qr')
  })
})

// ---------------------------------------------------------------- PROD-11: 58 mm receipt
describe('58 mm (2-inch) receipt (PROD-11)', () => {
  const R58 = RECEIPT_58MM_DEFAULT
  const R80 = RECEIPT_80MM_DEFAULT
  /** Visible text of an HTML fragment (tags dropped, entities the receipt uses decoded). */
  const text = (h: string): string => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()
  /** Each two-part line of the receipt (a totals row, a summary row, a flex row) as printed. */
  const lines = (html: string): string[] => [
    ...[...html.matchAll(/<table class="rc-tot">([\s\S]*?)<\/table>/g)].flatMap((m) => [...m[1]!.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map((r) => text(r[1]!))),
    ...[...html.matchAll(/<div class="rc-row rc-sm rc-gst">([\s\S]*?)<\/div>/g)].map((m) => text(m[1]!))
  ]

  it('is a built-in sales receipt on 58 mm roll paper, 48 mm printable', () => {
    expect(R58).toMatchObject({ id: 'receipt-58mm', builtIn: true, style: 'receipt', kinds: ['sales'] })
    expect(R58.page.size).toBe('Roll58')
    expect(58 - R58.page.marginsMm.left - R58.page.marginsMm.right).toBe(48)
    // The PDF page: 58 mm wide in inches, no page numbers; the 80 mm one unchanged.
    const p58 = pdfOptionsFor(R58, { itemCount: 3 })
    expect(p58.pageSize).toEqual({ width: 58 / 25.4, height: (160 + 14 * 3) / 25.4 })
    expect(p58.pageNumbers).toBe(false)
    expect(pdfOptionsFor(R80, { itemCount: 3 }).pageSize).toEqual({ width: 80 / 25.4, height: (120 + 10 * 3) / 25.4 })
    expect(rollHeightMm(3)).toBe(150)
    expect(rollHeightMm(500, 'Roll58')).toBe(2000)
  })

  it('holds about 32 characters a line (hand-worked: 48 mm = 181.4 px; a digit ≈ 0.55 em = 5.5 px at 10 px)', () => {
    const printablePx = ((58 - 5 - 5) / 25.4) * 96 // 181.417…
    expect(printablePx).toBeCloseTo(181.42, 2)
    expect(R58.typography.baseFontPx).toBe(10)
    expect(Math.floor(printablePx / (R58.typography.baseFontPx * 0.55))).toBe(RECEIPT_58MM_CHARS)
    expect(RECEIPT_58MM_CHARS).toBe(32)
    // The body font is the 10 px base (Classic 12 px scaled by 10 / 12).
    expect(renderDocument(R58, doc(INV))).toContain('body { font: 10px/1.35')
  })

  it('every amount line fits 32 characters up to ₹99,99,999.99 (hand-checked)', () => {
    // Worst case: 99,99,999.99 is 12 characters. "Taxable value" (13) + space + 12 = 26;
    // "18% on 99,99,999.99" (19) + space + "18,00,000.00" (12) = 32.
    const big = item({ qtyMilli: 1000, unitPricePaise: 999999999, taxablePaise: 999999999, cgst: 90000000, sgst: 90000000 })
    const html = renderDocument(R58, doc({ ...INV, items: [big], taxable: 999999999, cgst: 90000000, sgst: 90000000, total: 1179999999 }))
    const ls = lines(html)
    expect(ls).toContain('Taxable value 99,99,999.99')
    expect(ls).toContain('18% on 99,99,999.99 18,00,000.00')
    expect(ls).toContain('TOTAL ₹ 1,17,99,999.99')
    for (const l of ls) expect(l.length, l).toBeLessThanOrEqual(RECEIPT_58MM_CHARS)
  })

  it('wraps long item names and words; the 80 mm sheet keeps its stylesheet', () => {
    const long = item({ name: 'Extra-long-product-name-without-any-spaces-at-all-1234567890' })
    const html = renderDocument(R58, doc({ ...INV, items: [long] }))
    expect(html).toContain('<td colspan="2">Extra-long-product-name-without-any-spaces-at-all-1234567890</td>')
    expect(html).toContain('body { overflow-wrap: anywhere; }')
    expect(html).toContain('.rc-row { flex-wrap: wrap;')
    expect(html).toContain('table.rc-items td.r { white-space: nowrap;')
    const h80 = renderDocument(R80, doc({ ...INV, items: [long] }))
    expect(h80).not.toContain('overflow-wrap: anywhere; }')
    expect(h80).not.toContain('flex-wrap')
  })

  it('prints the GST summary one line per rate (no three-column table)', () => {
    const two = [item({ rate: 5, taxablePaise: 100000, cgst: 2500, sgst: 2500 }), item({ name: 'B', rate: 18, taxablePaise: 200000, cgst: 18000, sgst: 18000 })]
    const inv = { ...INV, items: two, taxable: 300000, cgst: 20500, sgst: 20500, total: 341000 }
    const html = renderDocument(R58, doc(inv))
    expect(html).not.toContain('<table class="rc-tax">')
    // 5%: tax 25.00 + 25.00 = 50.00 on 1,000.00; 18%: 180.00 + 180.00 = 360.00 on 2,000.00.
    expect(lines(html)).toEqual(expect.arrayContaining(['5% on 1,000.00 50.00', '18% on 2,000.00 360.00']))
    expect(renderDocument(R80, doc(inv))).toContain('<table class="rc-tax">')
  })

  it('scales the UPI QR to 28 mm above its words; never wider than the printable width', () => {
    const upi = { link: 'upi://pay?pa=shop@ybl&pn=Total%20Traders&am=1180.00&tn=Bill%201&cu=INR', upiId: 'shop@ybl', amountPaise: 118000 }
    const html = renderDocument(R58, { ...doc(INV), upi })
    expect(html).toContain('<div class="rc-upi" data-upi-qr>')
    expect(html).toContain('<div class="rc-qr"><div style="width:28mm;height:28mm">')
    expect(html).toContain(`Scan with any UPI app to pay ${formatPaise(118000, { symbol: true })} to shop@ybl`)
    expect(receiptQrMm(R58)).toBe(28)
    // Margins of 16 mm a side leave 26 mm: the QR takes 26.
    expect(receiptQrMm(printTemplateSchema.parse({ ...R58, page: { ...R58.page, marginsMm: { top: 3, right: 16, bottom: 4, left: 16 } } }))).toBe(26)
    // 80 mm keeps its 24 mm QR beside the words.
    expect(renderDocument(R80, { ...doc(INV), upi })).toContain('<div style="flex:none"><div style="width:24mm;height:24mm">')
  })

  it('a Hindi print puts the Devanagari face first, as on 80 mm', () => {
    const scriptFont = { family: 'Noto Sans Devanagari', css: '@font-face { font-family: "Noto Sans Devanagari"; }' }
    const html = renderDocument(R58, doc(INV), { scriptFont })
    expect(html).toContain(scriptFont.css)
    expect(html).toContain("body { font: 10px/1.35 'Noto Sans Devanagari', ")
  })

  it('an accounting voucher falls back to the compact layout on the same paper', () => {
    const html = renderDocument(R58, sampleDocument(COMPANY, 'receipt'))
    expect(html).toContain('RECEIPT')
    expect(html).not.toContain('rc-items')
  })
})
