// Phase 2b — "check with your CA" badges. ONE registry of every tax point Total implements but
// could not confirm in an official text (the UNVERIFIED lists in the code and the questions in
// docs/owner/09-questions-for-your-ca.md), saying for each:
//   - its plain sentence (i18n key `common.caCheck.point.<id>`, en + hi + hinglish — simple mode
//     reads it through t(), accountant screens in English),
//   - the rule / notification it is about,
//   - which UNVERIFIED list entries and CA questions it stands for,
//   - and either WHERE the app shows it (places — each a spot beside a figure, a date or the file
//     it concerns) or why it is CLOSED (its feature is hidden / removed, the owner accepted it …).
//
// Pure data: no i18n, no UI, and no import of the lists themselves (so the renderer bundle stays
// small) — `src/main/caCheck.test.ts` imports every list and proves each entry is covered here, that the
// places exist in the renderer, and that docs/owner/09 holds the block `caCheckDocBlock` writes.
// Badges never change a figure or a date; they only say "not confirmed yet".

/** Every spot a badge can sit. Prefix `simple.` = a simple-mode screen (words through t() in the
 *  user's language); everything else is an accountant screen (English, like the rest of it). */
export const CA_PLACES = {
  'simple.home.gst': 'Home → GST tile (its due date)',
  'simple.home.gstComposition': 'Home → GST tile of a composition business',
  'simple.taxes.collected': 'Taxes → GST you collected',
  'simple.taxes.onPurchases': 'Taxes → GST on purchases',
  'simple.taxes.toPay': 'Taxes → cash to pay',
  'simple.taxes.dueGstr1': 'Taxes → GSTR-1 due date',
  'simple.taxes.dueGstr3b': 'Taxes → GSTR-3B due date',
  'simple.taxes.pmt06': 'Taxes → PMT-06 dates (quarterly filers)',
  'simple.taxes.filing': 'Taxes → how often you file (quarterly filers)',
  'simple.taxes.export': 'Taxes → step 3, prepare the files',
  'simple.taxes.filed': 'Taxes → step 5, "I\'ve filed" (acknowledgement number)',
  'simple.taxes.composition': 'Taxes → composition dates (CMP-08, GSTR-4)',
  'simple.taxes.einvoice': 'Taxes → "e-invoicing applies to you"',
  'simple.taxes.tds': 'Taxes → TDS card',
  'simple.taxes.tcs': 'Taxes → TCS card',
  'simple.ratePicker': 'Every simple GST rate picker (new product, bill, purchase, money out, return, bank line)',
  'simple.returns.total': 'Returns → the return\'s total',
  'simple.hsnField': 'New product → HSN / SAC code',
  'simple.gstBlocked': 'Record a purchase / Money out → "Can you claim this GST back?" (s.17(5))',
  'gateway.compliance': 'Gateway → Compliance card, GST returns row',
  'gateway.tds': 'Gateway → Compliance card, TDS row',
  'gstr1.screen': 'GSTR-1 screen header',
  'gstr3b.screen': 'GSTR-3B screen header',
  'gstr3b.outward': 'GSTR-3B → 3.1(a) row',
  'gstr3b.itc': 'GSTR-3B → 4(B) / 4(D) rows',
  'gstr9.screen': 'GSTR-9 screen',
  'itc04.screen': 'ITC-04 screen',
  'itcReversal.screen': 'ITC reversal screen',
  'ims.tab': 'GSTR-2B → IMS tab',
  'gst2b.tab': 'Checks → GST 2B mismatches tab',
  'edocs.list': 'e-Invoice / e-way bill list',
  'edocs.details': 'e-Invoice details (cancel and extend)',
  'company.einvoiceProfile': 'Company details → e-invoicing',
  'company.registration': 'Company details → GST registration',
  'company.state': 'Company details → state',
  'masters.hsnField': 'Masters → stock item → HSN / SAC code',
  'masters.exportType': 'Masters → ledger → Export / SEZ type',
  'tds.screen': 'TDS screen header (rates, due dates, returns)',
  'tds.lateInterest': 'TDS → late-deduction interest',
  'tcs.screen': 'TCS screen header',
  'payroll.screen': 'Payroll screen header (salary TDS, Form 16)',
  'payables.msme': 'Payables → MSME tab',
  'cashForecast.screen': 'Cash forecast screen header',
  'editLog.screen': 'Edit log screen header'
} as const satisfies Record<string, string>

export type CaPlace = keyof typeof CA_PLACES

/** The UNVERIFIED lists exported from the code (by export name). */
export type CaListName =
  | 'GST_FILING_UNVERIFIED'
  | 'COMPLIANCE_UNVERIFIED'
  | 'ASSISTANT_UNVERIFIED'
  | 'GST_UNVERIFIED'
  | 'GST_RATE_UNVERIFIED'
  | 'GST_REGISTRATION_UNVERIFIED'
  | 'EINVOICE_APPLICABILITY_UNVERIFIED'
  | 'NIC_UNVERIFIED'
  | 'TCS_UNVERIFIED'
  | 'TDS_INTEREST_UNVERIFIED'
  | 'UNVERIFIED_WP37'
  | 'FIXED_ASSET_UNVERIFIED'
  | 'GATEWAY_UNVERIFIED'

/** One entry of a list: by its id / key, by position + a fragment of its text (lists of plain
 *  strings — the fragment catches a reorder), or the whole list. */
export type CaListRef = { list: CaListName; id: string } | { list: CaListName; at: number; has: string } | { list: CaListName; all: true }

export type CaClosedReason =
  /** The feature is hidden until used / not offered in 1.0 (Phase 1 triage §5). */
  | 'feature_hidden'
  /** The feature was removed (the 1.0 cleanup). */
  | 'feature_removed'
  /** The GST gateway is sandbox-only in 1.0; its API shapes are checked by the sandbox, not a CA. */
  | 'sandbox_only'
  /** The owner accepted it (Phase 1 triage §5). */
  | 'accepted'
  /** A pointer in a list, not a tax point. */
  | 'not_a_rule'

/** When a badge applies at its places (absent = always). */
export interface CaWhen {
  /** Only for a quarterly (QRMP) filer. */
  quarterly?: true
  /** Only for a date on / after this one (ISO) — e.g. the slabs read in secondary copies. */
  from?: string
}

interface CaBase {
  id: string
  /** The rule / notification it is about (shown in the popover, English in both modes — the law's names). */
  rule: string
  covers: readonly CaListRef[]
  /** docs/owner/09-questions-for-your-ca.md question numbers. */
  questions: readonly number[]
}

export type CaPoint = (CaBase & { places: readonly CaPlace[]; when?: CaWhen }) | (CaBase & { closed: CaClosedReason; note: string })

export const CA_POINTS = [
  // ---------- GST dates ----------
  {
    id: 'gst-due-dates',
    rule: 'Notification 83/2020-CT; rules 61 and 62 CGST Rules',
    covers: [
      { list: 'GST_FILING_UNVERIFIED', at: 0, has: 'Amendments to Notification 83/2020-CT' },
      { list: 'GST_FILING_UNVERIFIED', at: 5, has: 'Due-date extensions' },
      { list: 'COMPLIANCE_UNVERIFIED', at: 0, has: 'GSTR-1 on the 11th' },
      { list: 'ASSISTANT_UNVERIFIED', id: 'gstr1-11th' }
    ],
    questions: [3],
    places: ['simple.home.gst', 'simple.taxes.dueGstr1', 'simple.taxes.dueGstr3b', 'simple.taxes.composition', 'simple.home.gstComposition', 'gateway.compliance', 'gstr1.screen', 'gstr3b.screen']
  },
  {
    id: 'gstr3b-quarterly',
    rule: 'Rule 61(1)(ii) CGST Rules',
    covers: [
      { list: 'GST_FILING_UNVERIFIED', at: 3, has: 'Quarterly GSTR-3B is the 22nd or 24th' },
      { list: 'COMPLIANCE_UNVERIFIED', at: 1, has: 'Quarterly GSTR-3B' },
      { list: 'ASSISTANT_UNVERIFIED', id: 'gstr3b-qrmp' }
    ],
    questions: [3, 26],
    when: { quarterly: true },
    places: ['simple.home.gst', 'simple.taxes.dueGstr3b', 'gateway.compliance']
  },
  {
    id: 'qrmp-files',
    rule: 'Proviso to s.39(1) CGST Act; rule 59(2) CGST Rules (IFF)',
    covers: [
      { list: 'GST_FILING_UNVERIFIED', at: 1, has: 'invoice furnishing facility (IFF)' },
      { list: 'GST_FILING_UNVERIFIED', at: 2, has: 'prepared month by month' }
    ],
    questions: [27],
    when: { quarterly: true },
    places: ['simple.taxes.filing', 'simple.taxes.export', 'gateway.compliance']
  },
  {
    id: 'pmt06-amount',
    rule: 'Rule 61(3) CGST Rules (PMT-06)',
    covers: [{ list: 'GST_FILING_UNVERIFIED', at: 4, has: 'PMT-06' }],
    questions: [27],
    places: ['simple.taxes.pmt06', 'simple.home.gst'],
    when: { quarterly: true }
  },
  {
    id: 'composition-listed-elsewhere',
    rule: '—',
    covers: [{ list: 'COMPLIANCE_UNVERIFIED', at: 3, has: 'Composition returns (CMP-08, GSTR-4) are not listed here' }],
    questions: [],
    closed: 'not_a_rule',
    note: 'A pointer to where the composition dates are shown (simple Taxes), not a tax point; those dates carry the "gst-due-dates" badge.'
  },
  // ---------- GST rates ----------
  {
    id: 'gst-slabs-new',
    rule: 'Notifications 9/2025 and 19/2025-Central Tax (Rate); 02/2025-Compensation Cess (Rate)',
    covers: [
      { list: 'GST_RATE_UNVERIFIED', at: 0, has: 'The 2025 and 2026 slabs' },
      { list: 'GST_RATE_UNVERIFIED', at: 2, has: 'Compensation cess' },
      { list: 'GST_RATE_UNVERIFIED', at: 3, has: 'Biris at 18%' }
    ],
    questions: [4],
    when: { from: '2025-09-22' },
    places: ['simple.ratePicker']
  },
  {
    id: 'gst-services-rates',
    rule: 'The services rate notification replacing No. 11/2017-Central Tax (Rate)',
    covers: [{ list: 'GST_RATE_UNVERIFIED', at: 1, has: 'Rates on SERVICES after 22 September 2025' }],
    questions: [4],
    when: { from: '2025-09-22' },
    places: ['simple.ratePicker']
  },
  {
    id: 'gst-slab-choice',
    rule: 'HSN / SAC classification (Customs Tariff; Scheme of Classification of Services)',
    covers: [{ list: 'GST_RATE_UNVERIFIED', at: 4, has: 'HSN mapping' }],
    questions: [4],
    places: ['simple.ratePicker']
  },
  // ---------- registration ----------
  {
    id: 'composition-rules',
    rule: 's.10(4) CGST Act; s.9(3) / 9(4) (reverse charge)',
    covers: [
      { list: 'GST_REGISTRATION_UNVERIFIED', at: 0, has: 's.10(4) CGST Act' },
      { list: 'GST_REGISTRATION_UNVERIFIED', at: 2, has: 'Reverse-charge (RCM) supplies received by a composition dealer' }
    ],
    questions: [8],
    places: ['simple.taxes.composition', 'simple.home.gstComposition', 'company.registration']
  },
  {
    id: 'notes-follow-invoice',
    rule: 's.34 CGST Act',
    covers: [{ list: 'GST_REGISTRATION_UNVERIFIED', at: 1, has: 's.34 CGST Act' }],
    questions: [8],
    places: ['simple.returns.total']
  },
  {
    id: 'registration-history',
    rule: 'Registration (s.25 CGST Act) and its changes',
    covers: [{ list: 'GST_REGISTRATION_UNVERIFIED', at: 3, has: 'Only one change of registration' }],
    questions: [8],
    places: ['company.registration']
  },
  {
    id: 'gst-state-codes',
    rule: 'GST state-code list (GSTN)',
    covers: [],
    questions: [53],
    places: ['company.state']
  },
  // ---------- GST returns ----------
  {
    id: 'posted-tax-rupee',
    rule: 'GSTR-1 / GSTR-3B: tax charged vs rate on value',
    covers: [{ list: 'GST_UNVERIFIED', id: 'posted-tax-rupee' }],
    questions: [32],
    places: ['simple.taxes.collected', 'gstr1.screen', 'gstr3b.outward']
  },
  {
    id: 'zero-rated-with-payment',
    rule: 'IGST Act s.16(3) and (4) (zero-rated supply on payment of IGST, from 1 October 2023)',
    covers: [{ list: 'GST_UNVERIFIED', id: 'zero-rated-with-payment' }],
    questions: [55],
    places: ['masters.exportType']
  },
  {
    id: 'gstr3b-advances',
    rule: 'GSTR-3B 3.1(a) and GSTR-1 Tables 11A / 11B (advances)',
    covers: [{ list: 'GST_UNVERIFIED', id: 'gstr3b-advances' }],
    questions: [54],
    places: ['simple.taxes.toPay', 'gstr3b.outward']
  },
  {
    id: 'gstr3b-negative',
    rule: 'GSTR-3B save schema; portal handling of negative figures',
    covers: [{ list: 'GST_UNVERIFIED', id: 'gstr3b-negative' }],
    questions: [],
    places: ['simple.taxes.toPay', 'gstr3b.outward']
  },
  {
    id: 'gstr3b-schema-draft',
    rule: 'GSTR-3B save schema v7.1 (GSTN API portal, marked Draft)',
    covers: [{ list: 'GST_UNVERIFIED', id: 'gstr3b-schema-draft' }],
    questions: [],
    places: ['simple.taxes.export', 'gstr3b.screen']
  },
  {
    id: 'hsn-table12',
    rule: 'GSTR-1 Table 12 (HSN summary) advisories',
    covers: [{ list: 'GST_UNVERIFIED', id: 'hsn-sac-uqc' }],
    questions: [],
    places: ['simple.taxes.export', 'gstr1.screen']
  },
  {
    id: 'hsn-master',
    rule: 'GST portal HSN / SAC list (April 2026); Notifications 78/2020-CT and 90/2020-CT (HSN digits)',
    covers: [
      { list: 'GST_UNVERIFIED', id: 'hsn-master-list' },
      { list: 'GST_UNVERIFIED', id: 'hsn-digits' }
    ],
    questions: [],
    places: ['simple.hsnField', 'masters.hsnField']
  },
  {
    id: 'b2cl-limit',
    rule: 'Notification 12/2024-CT (B2C Large limit from 1 August 2024)',
    covers: [],
    questions: [33],
    places: ['gstr1.screen']
  },
  {
    id: 'gstr3b-4b-4d',
    rule: 'Notification 14/2022-CT; Circular 170/02/2022-GST',
    covers: [{ list: 'GST_UNVERIFIED', id: '3b-labels' }],
    questions: [5],
    places: ['gstr3b.itc', 'itcReversal.screen']
  },
  {
    id: 'gst-interest-18',
    rule: 's.50 CGST Act (interest rate)',
    covers: [{ list: 'GST_UNVERIFIED', id: 's50-rate' }],
    questions: [5],
    places: ['itcReversal.screen']
  },
  {
    id: 'gstr9-files',
    rule: 'Rule 80 CGST Rules; Notifications 13/2025 and 15/2025-CT',
    covers: [
      { list: 'GST_UNVERIFIED', id: 'gstr9-layout' },
      { list: 'GST_UNVERIFIED', id: 'gstr9-json' },
      { list: 'GST_UNVERIFIED', id: 'gstr9-exempt' }
    ],
    questions: [30],
    places: ['gstr9.screen']
  },
  {
    id: 'itc04-files',
    rule: 'Rule 45(3) CGST Rules (FORM ITC-04)',
    covers: [
      { list: 'GST_UNVERIFIED', id: 'itc04-json' },
      { list: 'GST_UNVERIFIED', id: 'itc04-hsn' }
    ],
    questions: [30],
    places: ['itc04.screen']
  },
  {
    id: 'ims-files',
    rule: 'Invoice Management System (GSTN)',
    covers: [
      { list: 'GST_UNVERIFIED', id: 'ims-json' },
      { list: 'GST_UNVERIFIED', id: 'ims-key' }
    ],
    questions: [30],
    places: ['ims.tab']
  },
  {
    id: 'gstr2b-fields',
    rule: 'GSTR-2B JSON (GSTN API portal); s.16(2)(aa) CGST Act',
    covers: [
      { list: 'ASSISTANT_UNVERIFIED', id: 'gstr2b-schema' },
      { list: 'ASSISTANT_UNVERIFIED', id: 'gstr2b-flags' },
      { list: 'ASSISTANT_UNVERIFIED', id: '2b-actions' }
    ],
    questions: [29],
    places: ['simple.taxes.onPurchases', 'gst2b.tab']
  },
  {
    id: 'itc-time-bar',
    rule: 's.16(4) CGST Act',
    covers: [{ list: 'ASSISTANT_UNVERIFIED', id: 's16-4-annual-return' }],
    questions: [5],
    places: ['simple.taxes.onPurchases', 'gst2b.tab']
  },
  {
    id: 'arn-format',
    rule: 'GST portal acknowledgement number (ARN)',
    covers: [],
    questions: [28],
    places: ['simple.taxes.filed']
  },
  // ---------- e-invoice / e-way bill ----------
  {
    id: 'einvoice-applicability',
    rule: 'Notification 13/2020-CT and amendments; GSTN advisory of 5 Nov 2024 (30-day window)',
    covers: [{ list: 'EINVOICE_APPLICABILITY_UNVERIFIED', all: true }],
    questions: [17, 54],
    places: ['simple.taxes.einvoice', 'company.einvoiceProfile', 'edocs.list']
  },
  {
    id: 'einvoice-file-rules',
    rule: 'e-invoice schema 1.1 (NIC); Circular 76/50/2018-GST (TCS)',
    covers: [{ list: 'GST_UNVERIFIED', id: 'einvoice-schema-repair' }],
    questions: [13, 14, 15],
    places: ['edocs.list']
  },
  {
    id: 'eway-challan-codes',
    rule: 'Rule 55 CGST Rules; e-way bill sub-supply codes (NIC master codes)',
    covers: [],
    questions: [16],
    places: ['edocs.list']
  },
  {
    id: 'nic-live',
    rule: 'NIC e-invoice / e-way bill API (cancel and extend windows)',
    covers: [{ list: 'NIC_UNVERIFIED', all: true }],
    questions: [18],
    places: ['edocs.details']
  },
  // ---------- TDS / TCS ----------
  {
    id: 'tds-deposit-date',
    rule: 'Rule 30(2) Income-tax Rules 1962; rule 218 Income-tax Rules 2026',
    covers: [{ list: 'COMPLIANCE_UNVERIFIED', at: 2, has: 'TDS deposit' }],
    questions: [23],
    places: ['simple.taxes.tds', 'gateway.tds', 'tds.screen']
  },
  {
    id: 'tds-rates-rounding',
    rule: 's.288B / s.516 (rounding); s.194Q; s.194N (Income-tax Act)',
    covers: [],
    questions: [6, 24],
    places: ['simple.taxes.tds', 'tds.screen']
  },
  {
    // WP 2d (review of #263): a bill marked "can't claim" keeps its Input GST lines (an asset) —
    // 4(A)(5) + 4(B)(1) only reverse it in the return — and the s.17(5) exceptions are the user's call.
    id: 'gst-blocked-credit',
    rule: 'CGST Act s.17(5); Circular 170/02/2022-GST (GSTR-3B 4(A)(5) / 4(B)(1))',
    covers: [],
    questions: [57],
    places: ['simple.gstBlocked']
  },
  {
    // WP 2d: purchase returns and the aggregate threshold (shared/tdsEligibility.ts header) — the
    // Act's "aggregate of the amounts credited or paid" read without the returns; not confirmed.
    id: 'tds-threshold-returns',
    rule: 'ss.194C(5), 194J, 194H, 194Q … Income-tax Act 1961; Income-tax Act 2025 s.393 Table — "the aggregate of the amounts credited or paid"',
    covers: [],
    questions: [56],
    places: ['tds.screen']
  },
  {
    id: 'tds-return-layouts',
    rule: 'Form 26Q, Form 16A (TRACES utility)',
    covers: [],
    questions: [25],
    places: ['tds.screen']
  },
  {
    id: 'tds-late-interest',
    rule: 's.201(1A) Income-tax Act 1961 (2025 Act s.398(3)(a))',
    covers: [{ list: 'TDS_INTEREST_UNVERIFIED', all: true }],
    questions: [22],
    places: ['tds.lateInterest']
  },
  {
    id: 'tcs-rules',
    rule: 's.206C(1C), (1G), (1H) Income-tax Act; Form 27EQ / Form 143',
    covers: [{ list: 'TCS_UNVERIFIED', all: true }],
    questions: [19, 20, 21],
    places: ['simple.taxes.tcs', 'tcs.screen']
  },
  {
    id: 'payroll-salary-tds',
    rule: 's.192 Income-tax Act; Form 16 Part B (1962 Rules)',
    covers: [
      { list: 'UNVERIFIED_WP37', at: 6, has: 'Income tax 1961 texts' },
      { list: 'UNVERIFIED_WP37', at: 7, has: 'Salary TDS rounded' },
      { list: 'UNVERIFIED_WP37', at: 8, has: 'Form 16 Part B' }
    ],
    questions: [7, 42, 43],
    places: ['payroll.screen']
  },
  // ---------- other ----------
  {
    id: 'msme-43bh',
    rule: 's.43B(h) and s.37 Income-tax Act; MSMED Act s.15',
    covers: [],
    questions: [35],
    places: ['payables.msme']
  },
  {
    // WP 2d (review of #261): with a recorded day of acceptance, whether a supplier was covered
    // (registered) is judged on the day of SUPPLY — a recorded delivery day, else the bill date;
    // a removed objection never brings an earlier supply in. Not read in a judgment or official text.
    id: 'msme-acceptance-coverage',
    rule: 'MSMED Act s.2(b) Explanation, s.2(n), s.15 — day of acceptance; registration before the supply',
    covers: [],
    questions: [54],
    places: ['payables.msme']
  },
  {
    id: 'msme-form1-udyam',
    rule: 'MSME Form 1 (MSMED Act s.9); Udyam registration number',
    covers: [],
    questions: [36],
    places: ['payables.msme']
  },
  {
    id: 'forecast-dates',
    rule: 'Statutory due dates in the cash forecast (GST, TDS)',
    covers: [],
    questions: [50, 37, 54],
    places: ['cashForecast.screen']
  },
  {
    id: 'audit-retention',
    rule: 's.128(5) Companies Act; Income-tax rule 6F; IT Act 2025 s.62 / Rules 2026 r.46(9)',
    covers: [],
    questions: [52],
    places: ['editLog.screen']
  },
  // ---------- closed with their feature ----------
  {
    id: 'fixed-assets',
    rule: 'Schedule II Companies Act; rules 40(2) / 44(6) CGST Rules; s.32 / s.50 Income-tax Act',
    covers: [{ list: 'FIXED_ASSET_UNVERIFIED', all: true }],
    questions: [1, 2, 9, 10, 11, 12, 44, 45, 46, 47, 48, 49],
    closed: 'feature_removed',
    note: 'The fixed-asset register was removed (audit A13b); depreciation / disposal journals in older books stay as ordinary entries, and the s.18(6) extra tax an old GST disposal posted is still read into GSTR-1 / 3B (the cg-* entries record how).'
  },
  {
    id: 'payroll-statutory',
    rule: 'EPF / ESI / PT, gratuity and bonus under the Codes',
    covers: [
      { list: 'UNVERIFIED_WP37', at: 0, has: 'EPF: the September-2026' },
      { list: 'UNVERIFIED_WP37', at: 1, has: 'EPF: the admin-charge' },
      { list: 'UNVERIFIED_WP37', at: 2, has: 'ECR' },
      { list: 'UNVERIFIED_WP37', at: 3, has: 'ESI: the legal basis' },
      { list: 'UNVERIFIED_WP37', at: 4, has: 'ESI: the ESIC portal' },
      { list: 'UNVERIFIED_WP37', at: 5, has: 'PT:' },
      { list: 'UNVERIFIED_WP37', at: 9, has: 'Gratuity' }
    ],
    questions: [7, 38, 39, 40, 41, 42],
    closed: 'feature_removed',
    note: 'Payroll PF / ESI / PT was removed (audit A13b): pay runs no longer deduct them; runs, dues and payments in older books stay as saved. The compute-only gratuity / bonus helper (Payroll → Salary TDS) posts nothing.'
  },
  {
    id: 'receivables-interest',
    rule: 's.12(6) / 13(6) CGST Act (interest); SAC 9971',
    covers: [],
    questions: [31],
    closed: 'feature_removed',
    note: 'Interest on overdue bills was removed (audit A13b); old interest debit notes stay as ordinary entries.'
  },
  {
    id: 'msme-interest',
    rule: 'MSMED Act s.16 (3 × the RBI bank rate)',
    covers: [],
    questions: [34],
    closed: 'feature_hidden',
    note: 'MSME interest is indicative and never posted; it closes with the feature (Phase 1 triage §5).'
  },
  {
    id: 'forex',
    rule: 'AS 11 / Ind AS 21',
    covers: [],
    questions: [51],
    closed: 'feature_removed',
    note: 'Forex revaluation and settlement were removed in the 1.0 cleanup (PR #195).'
  },
  {
    id: 'gateway-api',
    rule: 'GSTN returns API (developer.gst.gov.in, behind sign-in)',
    covers: [{ list: 'GATEWAY_UNVERIFIED', all: true }],
    questions: [],
    closed: 'sandbox_only',
    note: 'The GST gateway is sandbox-only in 1.0 (live switch off); its API shapes are proved by a GSP sandbox, not a CA.'
  },
  {
    id: 'busy-zoho-headers',
    rule: 'Busy / Zoho export layouts',
    covers: [],
    questions: [],
    closed: 'accepted',
    note: 'Import header spellings — the owner accepted them (Phase 1 triage §5); the import screen still names them.'
  }
] as const satisfies readonly CaPoint[]

export type CaPointId = (typeof CA_POINTS)[number]['id']

const POINTS: readonly CaPoint[] = CA_POINTS

/** `gst-due-dates` → `common.caCheck.point.gstDueDates` (catalogue keys are dotted camelCase). */
export const caPointKey = (id: string): string => `common.caCheck.point.${id.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase())}`

export const isBadged = (p: CaPoint): p is CaBase & { places: readonly CaPlace[]; when?: CaWhen } => 'places' in p

/** What the place's caller knows about the figure / date beside the badge. */
export interface CaContext {
  quarterly?: boolean
  /** The date the figure is for (a bill's date, the working date). */
  date?: string
}

export function applies(p: CaPoint, ctx: CaContext = {}): boolean {
  if (!isBadged(p)) return false
  if (p.when?.quarterly && !ctx.quarterly) return false
  if (p.when?.from && !(ctx.date && ctx.date >= p.when.from)) return false
  return true
}

/** The points shown at `place` for `ctx`, in registry order. */
export function caPointsAt(place: CaPlace, ctx: CaContext = {}): CaPoint[] {
  return POINTS.filter((p) => isBadged(p) && p.places.includes(place) && applies(p, ctx))
}

const CLOSED_LABEL: Record<CaClosedReason, string> = {
  feature_hidden: 'closed — feature hidden',
  feature_removed: 'closed — feature removed',
  sandbox_only: 'closed — sandbox only',
  accepted: 'closed — accepted by the owner',
  not_a_rule: 'closed — not a tax point'
}

export const CA_DOC_START = '<!-- ca-check:start (generated from src/shared/caCheck.ts — do not edit by hand) -->'
export const CA_DOC_END = '<!-- ca-check:end -->'

/** The block docs/owner/09-questions-for-your-ca.md carries between the markers — every point,
 *  its sentence (the English catalogue), the questions it answers, and where the badge shows or
 *  why it is closed. `caCheck.test.ts` fails when the doc and the registry differ. */
export function caCheckDocBlock(sentence: (key: string) => string): string {
  const lines = [
    CA_DOC_START,
    '',
    '## In the app: "check with your CA" badges',
    '',
    'Each point below shows as a small "Check with your CA" badge beside the figure or date it touches.',
    'When the CA confirms one, Claude removes it from `src/shared/caCheck.ts` (and its UNVERIFIED',
    'note); this list is rewritten from that file, so it never drifts from what the app shows.',
    '',
    '| Point | What the badge says | Questions | Where |',
    '| --- | --- | --- | --- |'
  ]
  const cell = (s: string): string => s.replace(/\|/g, '\\|')
  for (const p of POINTS) {
    const qs = p.questions.length ? p.questions.map((q) => `Q${q}`).join(', ') : '—'
    if (isBadged(p)) {
      const when = p.when?.quarterly ? ' (quarterly filers)' : p.when?.from ? ` (from ${p.when.from})` : ''
      const where = p.places.map((pl) => CA_PLACES[pl]).join('; ') + when
      lines.push(`| \`${p.id}\` | ${cell(sentence(caPointKey(p.id)))} *(${cell(p.rule)})* | ${qs} | ${cell(where)} |`)
    } else {
      lines.push(`| \`${p.id}\` | ${cell(p.note)} | ${qs} | ${CLOSED_LABEL[p.closed]} |`)
    }
  }
  lines.push('', CA_DOC_END)
  return lines.join('\n')
}
