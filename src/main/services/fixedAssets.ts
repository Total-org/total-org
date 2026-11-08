/**
 * What is left of the fixed-asset register (WP 3.6), removed in the feature cleanup (audit A13b).
 * There is no screen and no channel any more; the tables (fixed_assets, fixed_asset_groups,
 * fixed_asset_additions, depreciation_runs / _lines, it_blocks …, ca_asset_classes), migration 026
 * and the audit entities stay, so a book that used the register opens and reads exactly as before:
 *
 * - The depreciation / disposal journals it posted are ordinary vouchers in every report, but stay
 *   immutable except through the bin (an edit would leave depreciation_runs out of step), and a
 *   GST disposal's journal and its tax invoice go to and come back from the bin as a pair.
 * - The s.18(6) extra output tax a GST disposal journal posted is added to its tax invoice's outward
 *   document (applyCapitalGoodsExtraTax, read by extractOutwardDocs).
 * - The year-end close preview still reports whether book depreciation was run (yearStatus).
 * - The cash-flow add-back of depreciation runs lives in reports.ts.
 */
import type { DB } from '../db/connection'
import { fyFromStartYear } from '@shared/dates'
import { lifeEndDate } from '@shared/depreciation'
import type { DepreciationYearStatus } from '@shared/fixedAssets'
import type { GstDoc } from '@shared/gst/returns'
import { headsTotal, ZERO_TAX_HEADS, type TaxHeads } from '@shared/capitalGoodsGst'
import { getLockDate, getVoucher, NOT_DELETED, IRN_LIVE_BIN, liveIrnOf } from './vouchers'
import { AppError } from '@shared/errors'
import { writeAudit } from './audit'

/** 'YYYY-MM-DD' → 'DD-MM-YYYY' for messages. */
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}-${m}-${y}`
}

// ---------------------------------------------------------------------------------------------
// GST on the sale of a capital good — CGST Act s.18(6), rules 40(2) / 44(6)
// (src/shared/capitalGoodsGst.ts; texts FIXED_ASSET_EVENT_SOURCES CGST-*)
// ---------------------------------------------------------------------------------------------

/** meta key: { [disposal journal id]: tax invoice id } — the invoice a GST disposal posted. */
const SALE_INVOICES_META = 'fixedAssets.saleInvoices'

function saleInvoices(db: DB): Record<string, number> {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(SALE_INVOICES_META) as { value: string } | undefined
  if (!row) return {}
  try {
    const v = JSON.parse(row.value) as Record<string, number>
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

/** The tax invoice a GST disposal journal posted (null for a disposal without GST). */
export function saleInvoiceOf(db: DB, journalId: number): number | null {
  return saleInvoices(db)[String(journalId)] ?? null
}

/**
 * Rule 44(6) proviso: the s.18(6) amount beyond the tax on the transaction value "shall form part of
 * the output tax liability and the same shall be furnished in FORM GSTR-1". The disposal journal
 * posts that excess as output tax; here it is added to the TAX INVOICE's outward document (taxable
 * value and rate unchanged, the tax raised), so GSTR-1, GSTR-3B 3.1(a), GSTR-9 and the HSN summary
 * all carry what the books post for that invoice (FIXED_ASSET_UNVERIFIED 'cg-where'). Read from the
 * live disposal journals' Cr output-tax lines; returns `docs` untouched for a company without such
 * sales. Called by extractOutwardDocs.
 */
export function applyCapitalGoodsExtraTax(db: DB, docs: readonly GstDoc[], from: string, to: string): GstDoc[] {
  const links = saleInvoices(db)
  const journalIds = Object.keys(links).map(Number)
  if (journalIds.length === 0) return [...docs]
  const lineStmt = db.prepare(
    `SELECT l.tax_type AS taxType, SUM(vl.amount) AS amount FROM voucher_lines vl JOIN ledgers l ON l.id = vl.ledger_id
      WHERE vl.voucher_id = ? AND vl.dr_cr = 'cr' AND l.tax_type IS NOT NULL GROUP BY l.tax_type`
  )
  const extraByInvoice = new Map<number, TaxHeads>()
  for (const jid of journalIds) {
    const v = db.prepare(`SELECT v.id FROM vouchers v WHERE v.id = ? AND ${NOT_DELETED} AND v.date BETWEEN ? AND ?`).get(jid, from, to)
    if (!v) continue
    const heads = { ...ZERO_TAX_HEADS }
    for (const r of lineStmt.all(jid) as { taxType: keyof TaxHeads; amount: number }[]) heads[r.taxType] += r.amount
    if (headsTotal(heads) > 0) extraByInvoice.set(links[String(jid)]!, heads)
  }
  if (extraByInvoice.size === 0) return [...docs]
  return docs.map((d) => {
    const extra = extraByInvoice.get(d.voucherId)
    if (!extra) return d
    const add = <T extends { cgst: number; sgst: number; igst: number; cess: number }>(x: T): T =>
      ({ ...x, cgst: x.cgst + extra.cgst, sgst: x.sgst + extra.sgst, igst: x.igst + extra.igst, cess: x.cess + extra.cess })
    // Onto the invoice's (one) rated line; a rate-less invoice (a free disposal) gets a 0-value line.
    const items = d.items.length > 0 ? d.items.map((it, i) => (i === 0 ? add(it) : it)) : [add({ rate: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0 })]
    const hsnLines = d.hsnLines.map((h, i) => (i === 0 ? add(h) : h))
    return { ...d, items, hsnLines }
  })
}

/** Inside deleteVoucher's transaction: a GST disposal's tax invoice and journal go to the bin
 *  together (the journal clears the invoice's value; the invoice carries the sale the journal
 *  describes). Binning either bins the other. */
export function binFixedAssetPartner(db: DB, voucherId: number): void {
  const partner = fixedAssetPartnerOf(db, voucherId)
  if (partner == null || !db.prepare(`SELECT 1 FROM vouchers v WHERE v.id = ? AND ${NOT_DELETED}`).get(partner)) return
  const lock = getLockDate(db)
  const pv = db.prepare('SELECT date FROM vouchers WHERE id = ?').get(partner) as { date: string }
  if (lock && pv.date <= lock) throw new Error(`Books are locked up to ${lock} (the paired voucher is dated ${pv.date})`)
  // The paired tax invoice goes to the bin too — not while its e-invoice IRN is live.
  if (liveIrnOf(db, partner)) throw new AppError('irn_live', IRN_LIVE_BIN)
  const before = getVoucher(db, partner)
  db.prepare("UPDATE vouchers SET deleted_at = datetime('now') WHERE id = ?").run(partner)
  writeAudit(db, 'voucher', partner, 'delete', before, { pairedWith: voucherId })
}

/** Inside restoreVoucher's transaction: a restored GST disposal journal brings its tax invoice
 *  back with it (the invoice alone may be restored on its own — it is an ordinary sale). */
export function restoreFixedAssetPartners(db: DB, voucherId: number): void {
  const invoiceId = saleInvoiceOf(db, voucherId)
  if (invoiceId == null || db.prepare(`SELECT 1 FROM vouchers v WHERE v.id = ? AND ${NOT_DELETED}`).get(invoiceId)) return
  const lock = getLockDate(db)
  const before = getVoucher(db, invoiceId)
  if (!before) return
  if (lock && before.date <= lock) throw new Error(`Books are locked up to ${lock} (the tax invoice is dated ${before.date})`)
  db.prepare('UPDATE vouchers SET deleted_at = NULL WHERE id = ?').run(invoiceId)
  writeAudit(db, 'voucher', invoiceId, 'restore', before, { restored: true, pairedWith: voucherId })
}

/** The other half of a GST disposal pair: the journal's invoice, or the invoice's journal. */
function fixedAssetPartnerOf(db: DB, voucherId: number): number | null {
  const links = saleInvoices(db)
  const asJournal = links[String(voucherId)]
  if (asJournal != null) return asJournal
  const asInvoice = Object.entries(links).find(([, inv]) => inv === voucherId)
  return asInvoice ? Number(asInvoice[0]) : null
}

// ---------------------------------------------------------------------------------------------
// Voucher guards (called from services/vouchers.ts)
// ---------------------------------------------------------------------------------------------

export const FIXED_ASSET_VOUCHER_EDIT =
  'This journal was posted by Total’s former fixed-asset register (a depreciation run or a disposal) — it can’t be edited, only moved to the bin'

/** A depreciation / disposal journal is owned by its run: an edit would leave the register's
 *  depreciation lines out of step with the books. */
export function assertNotFixedAssetVoucher(db: DB, voucherId: number): void {
  const owned = db.prepare(
    'SELECT 1 FROM depreciation_runs WHERE voucher_id = ? UNION SELECT 1 FROM fixed_assets WHERE disposal_voucher_id = ? LIMIT 1'
  ).get(voucherId, voucherId)
  if (owned) throw new Error(FIXED_ASSET_VOUCHER_EDIT)
  // The tax invoice of a GST disposal: its value is cleared by the disposal journal.
  if (Object.values(saleInvoices(db)).includes(voucherId)) {
    throw new Error('This tax invoice was posted by a fixed-asset disposal (Total’s former fixed-asset register) — it can’t be edited, only moved to the bin (the disposal journal goes with it)')
  }
}

/** Restoring a binned depreciation journal must not double-charge a period that was
 *  re-run before the cut; restoring a disposal journal must not resurrect a disposal the asset no longer has. */
export function assertFixedAssetVoucherRestorable(db: DB, voucherId: number): void {
  const run = db.prepare('SELECT period_from AS "from", period_to AS "to", asset_id FROM depreciation_runs WHERE voucher_id = ? AND asset_id IS NULL')
    .get(voucherId) as { from: string; to: string } | undefined
  if (run) {
    const clash = db.prepare(
      `SELECT r.period_from AS "from", r.period_to AS "to" FROM depreciation_runs r JOIN vouchers v ON v.id = r.voucher_id
        WHERE ${NOT_DELETED} AND r.asset_id IS NULL AND r.voucher_id <> ? AND r.period_from <= ? AND r.period_to >= ? LIMIT 1`
    ).get(voucherId, run.to, run.from) as { from: string; to: string } | undefined
    if (clash) throw new Error(`Depreciation for ${fmtDate(clash.from)} to ${fmtDate(clash.to)} has been posted again since — bin that run to restore this one`)
  }
  // A GST disposal's journal comes back with its tax invoice (restoreFixedAssetPartners) — the
  // invoice must still exist (not purged).
  const invoiceId = saleInvoiceOf(db, voucherId)
  if (invoiceId != null && !db.prepare('SELECT 1 FROM vouchers WHERE id = ?').get(invoiceId)) {
    throw new Error('The sale\'s tax invoice was purged — this disposal journal can\'t be restored')
  }
  const disposalOf = db.prepare('SELECT id FROM depreciation_runs WHERE voucher_id = ? AND asset_id IS NOT NULL').get(voucherId)
  const asset = db.prepare('SELECT id, disposal_voucher_id FROM fixed_assets WHERE disposal_voucher_id = ?').get(voucherId)
  if (disposalOf && !asset) throw new Error('This disposal no longer belongs to its asset — it can\'t be restored')
}

// ---------------------------------------------------------------------------------------------
// Year-end check
// ---------------------------------------------------------------------------------------------

/** Has book depreciation been run up to 31 March for every asset in service in the FY? */
export function yearStatus(db: DB, fyStartYear: number): DepreciationYearStatus {
  const fy = fyFromStartYear(fyStartYear)
  const assets = (db.prepare(
    `SELECT a.put_to_use_date AS putToUse, a.useful_life_months AS lifeMonths, a.disposal_date AS disposalDate,
            a.disposal_voucher_id AS disposalVoucherId,
            (SELECT v.deleted_at IS NULL FROM vouchers v WHERE v.id = a.disposal_voucher_id) AS disposalLive
       FROM fixed_assets a ORDER BY a.name, a.id`
  ).all() as { putToUse: string; lifeMonths: number; disposalDate: string | null; disposalVoucherId: number | null; disposalLive: number | null }[])
    // The disposal counts only while its journal is live.
    .map((a) => ({ ...a, disposedOn: a.disposalVoucherId != null && !!a.disposalLive ? a.disposalDate : null }))
  const inService = assets.filter((a) => {
    if (a.putToUse > fy.to) return false
    const d = a.disposedOn
    if (d && d <= fy.from) return false
    // Fully written down before the year began: nothing to charge.
    const lifeEnd = lifeEndDate(a.putToUse, a.lifeMonths)
    return lifeEnd >= fy.from
  })
  const covered = db.prepare(
    `SELECT MAX(r.period_to) AS t FROM depreciation_runs r JOIN vouchers v ON v.id = r.voucher_id
      WHERE ${NOT_DELETED} AND r.asset_id IS NULL AND r.basis = 'companies_act' AND r.period_to BETWEEN ? AND ?`
  ).get(fy.from, fy.to) as { t: string | null }
  // Assets disposed during the year are covered by their disposal's catch-up.
  const needsRun = inService.some((a) => !a.disposedOn)
  return {
    fyStartYear,
    assetsInService: inService.length,
    coveredThrough: covered.t,
    missing: needsRun && covered.t !== fy.to
  }
}
