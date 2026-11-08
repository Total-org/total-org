/**
 * WP 4.2 — receivables: statements of account, reminder letters, credit control (holds,
 * exposure), follow-ups / promised dates, collection reports.
 *
 * Nothing here stores a balance. Statements are the ledger statement (reports.ledgerStatement)
 * plus the Outstandings allocation (analysis.partyAllocation); reminders, credit control and the
 * collection reports all read analysis.outstandings at query time. The only rows this module owns
 * are facts that are not derivable: reminder_log (what was sent), bill_followups (notes and
 * promises) and the credit hold on the ledger (migration 032).
 *
 * Interest on overdue bills was removed (audit A13b): `interest_charges` stays so old books open
 * and their interest debit notes stay immutable except bin (vouchers.ts), and the opening-bill
 * guard (openingBills.ts) still reads it.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DB } from '../db/connection'
import type { CompanyInfo } from '@shared/domain'
import type { OutstandingBill, OutstandingParty } from '@shared/reports'
import { formatPaise } from '@shared/money'
import { toDisplayDate } from '@shared/dates'
import { pdfOptionsFor } from '@shared/printTemplates'
import { renderDocument, type ReminderDocument, type StatementDocument } from '@shared/print/render'
import {
  parseReceivablesConfig, receivablesConfigSchema, RECEIVABLES_META_KEY, REMINDER_BUCKET_LABELS,
  type ReceivablesConfig, type ReminderBucket, type ReminderChannel, type ReminderLogChannel, DEFAULT_RECEIVABLES_CONFIG
} from '@shared/receivables/config'
import { ageingBuckets, mailtoLink, mergeTemplate, reminderBucketFor, reminderCadence, reminderFields } from '@shared/receivables/reminders'
import { addDaysIso } from '@shared/receivables/interest'
import { collectionMonth, monthEndIso, monthsBetween, monthStartIso, partyDso } from '@shared/receivables/collections'
import {
  billKeyOf, type CollectionReport, type CreditControlRow, type FollowupRow, type PromisedSummary, type ReminderBulkResult, type ReminderCandidate, type ReminderLogRow, type ReminderResult,
  type StatementData, type StatementPdfResult, type StatementRow, type StatementsBulkResult, type TopOverdueRow
} from '@shared/receivables/types'
import type { FollowupInput } from '@shared/receivables/schemas'
import { followupInputSchema } from '@shared/receivables/schemas'
import { ledgerStatement } from './reports'
import { outstandings, partyAllocation, registerVoucherRows } from './analysis'
import { partyGroupIdsBySide } from './masters'
import { resolveTemplate } from './printTemplates'
import { plexFontFaceCss } from './printFonts'
import { printLocale } from './printLocale'
import { companyT } from '../i18n'
import type { MessageKey, Translate } from '@shared/i18n'
import { partySide } from './openingBills'
import { htmlToPdf } from './pdf'
import { openSalesOrderValue } from './tradeDocs'
import { IN_BOOKS } from './vouchers'
import { currentAuditUserName, writeAudit } from './audit'
import { companyExportsDir } from '../paths'

const RENDER_OPTS = { fontFaceCss: plexFontFaceCss }
const rupees = (p: number): string => formatPaise(p, { symbol: true })

// ---------------------------------------------------------------- config

export function getReceivablesConfig(db: DB): ReceivablesConfig {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(RECEIVABLES_META_KEY) as { value: string } | undefined
  let raw: unknown = {}
  try {
    raw = row ? JSON.parse(row.value) : {}
  } catch {
    raw = {}
  }
  return parseReceivablesConfig(raw)
}

export function setReceivablesConfig(db: DB, input: unknown): ReceivablesConfig {
  const before = getReceivablesConfig(db)
  const parsed = receivablesConfigSchema.parse(input)
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(RECEIVABLES_META_KEY, JSON.stringify(parsed))
  writeAudit(db, 'company', 0, 'update', { receivables: before }, { receivables: parsed })
  return parsed
}

// ---------------------------------------------------------------- parties

interface PartyRow {
  id: number; name: string; address: string | null; gstin: string | null; email: string | null; stateCode: string | null
  groupId: number; openingBalance: number; creditLimit: number | null
  creditDays: number | null; exportType: 'sez_wp' | 'sez_wop' | 'exp_wp' | 'exp_wop' | null
  hold: number; holdReason: string | null; holdAt: string | null
}

const PARTY_SQL = `SELECT id, name, address, gstin, email, state_code AS stateCode, group_id AS groupId, opening_balance AS openingBalance, credit_limit AS creditLimit,
  credit_hold AS hold, credit_hold_reason AS holdReason,
  credit_hold_at AS holdAt, credit_days AS creditDays, export_type AS exportType FROM ledgers`

function partyRow(db: DB, id: number): PartyRow {
  const p = db.prepare(`${PARTY_SQL} WHERE id = ?`).get(id) as PartyRow | undefined
  if (!p) throw new Error('Party ledger not found')
  return p
}

function debtorRows(db: DB): PartyRow[] {
  const ids = partyGroupIdsBySide(db, 'debtor')
  return (db.prepare(`${PARTY_SQL} ORDER BY name`).all() as PartyRow[]).filter((p) => ids.has(p.groupId))
}

const safeName = (s: string): string => s.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'party'

// ---------------------------------------------------------------- statements

/** Bill-wise allocation text per voucher from bill_refs ("New ref INV-7 · Agst ref INV-3 ₹500"). */
function allocationText(db: DB, partyId: number, voucherIds: number[]): Map<number, string> {
  const out = new Map<number, string>()
  if (!voucherIds.length) return out
  const rows = db
    .prepare(
      `SELECT voucher_id AS voucherId, kind, name, amount FROM bill_refs WHERE party_ledger_id = ? AND voucher_id IN (${voucherIds.map(() => '?').join(',')}) ORDER BY id`
    )
    .all(partyId, ...voucherIds) as { voucherId: number; kind: 'new' | 'against'; name: string; amount: number }[]
  const by = new Map<number, string[]>()
  for (const r of rows) {
    const list = by.get(r.voucherId) ?? []
    list.push(`${r.kind === 'new' ? 'New ref' : 'Agst ref'} ${r.name} ${rupees(r.amount)}`)
    by.set(r.voucherId, list)
  }
  for (const [id, list] of by) out.set(id, list.join(' · '))
  return out
}

/** The statement of account: the ledger statement for the period (opening, every voucher, closing
 *  — identical figures), each voucher's bill-wise allocation, the open bills and their ageing as on
 *  `to`, the payment request and the bank details of the statement template. */
export function statementData(db: DB, company: CompanyInfo, ledgerId: number, from: string, to: string): StatementData {
  const p = partyRow(db, ledgerId)
  const ls = ledgerStatement(db, ledgerId, from, to)
  const alloc = allocationText(db, ledgerId, [...new Set(ls.rows.map((r) => r.voucherId))])
  const rows: StatementRow[] = ls.rows.map((r) => ({
    voucherId: r.voucherId, date: r.date, voucherType: r.voucherType, number: r.number, particulars: r.particulars,
    narration: r.narration, debit: r.debit, credit: r.credit, running: r.running,
    allocation: alloc.get(r.voucherId) ?? (r.credit > 0 ? 'Against the oldest open bills' : '')
  }))
  const allocation = partyAllocation(db, ledgerId, to)
  const cfg = getReceivablesConfig(db)
  const template = resolveTemplate(db, 'statement')
  const fields = {
    party: p.name, company: company.name, from: toDisplayDate(from), to: toDisplayDate(to),
    closing: `${rupees(Math.abs(ls.closing))}${ls.closing === 0 ? '' : ls.closing > 0 ? ' Dr' : ' Cr'}`
  }
  const subject = mergeTemplate(cfg.statementEmail.subject, fields)
  const body = mergeTemplate(cfg.statementEmail.body, fields)
  return {
    party: { id: p.id, name: p.name, address: p.address, gstin: p.gstin, email: p.email },
    from, to,
    opening: ls.opening, closing: ls.closing, totalDebit: ls.totalDebit, totalCredit: ls.totalCredit,
    rows,
    openBills: allocation.bills,
    buckets: ageingBuckets(allocation.bills),
    unapplied: allocation.unappliedCredit,
    paymentRequest: cfg.paymentRequest,
    bank: template.footer.bankDetails,
    email: { subject, body, mailto: mailtoLink(p.email, subject, body) }
  }
}

export function statementHtml(db: DB, company: CompanyInfo, ledgerId: number, from: string, to: string): { html: string; data: StatementData } {
  const data = statementData(db, company, ledgerId, from, to)
  const doc: StatementDocument = { shape: 'statement', kind: 'statement', company, statement: data }
  const locale = printLocale(db)
  if (locale.lang === 'en') return { html: renderDocument(locale.template(resolveTemplate(db, 'statement')), doc, locale.opts), data }
  // WP 10.4 review: a localised statement says its rows in the company language too (the entry's
  // kind instead of the English type name, the bill-wise lines without "New ref / Agst ref"), and
  // a supplier's statement puts their bills in the credit column, an advance paid under "paid".
  const t = companyT(db)
  const paymentRequest = data.paymentRequest === DEFAULT_RECEIVABLES_CONFIG.paymentRequest ? t('simple.print.paymentRequest') : data.paymentRequest
  const printed: StatementDocument = { ...doc, statement: { ...data, paymentRequest, rows: localisedStatementRows(db, ledgerId, data.rows, t) } }
  const labels = locale.opts.labels!
  const sup = labels.supplierStatement
  const opts =
    sup && partySide(db, partyRow(db, ledgerId).groupId) === -1
      ? { ...locale.opts, labels: { ...labels, debit: sup.debit, credit: sup.credit, unadjusted: sup.unadjusted } }
      : locale.opts
  return { html: renderDocument(locale.template(resolveTemplate(db, 'statement')), printed, opts), data }
}

const KIND_WORD: Record<string, MessageKey> = {
  sales: 'simple.print.kind.sales', purchase: 'simple.print.kind.purchase', receipt: 'simple.print.kind.receipt', payment: 'simple.print.kind.payment',
  credit_note: 'simple.print.kind.creditNote', debit_note: 'simple.print.kind.debitNote'
}

/** The statement rows in the company language: each entry named by its kind, its bill-wise lines in plain words. */
function localisedStatementRows(db: DB, partyId: number, rows: StatementRow[], t: Translate): StatementRow[] {
  if (!rows.length) return rows
  const ids = [...new Set(rows.map((r) => r.voucherId))]
  const kinds = new Map(
    (db.prepare(`SELECT v.id, vt.kind FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id WHERE v.id IN (${ids.map(() => '?').join(',')})`).all(...ids) as { id: number; kind: string }[]).map((r) => [r.id, r.kind])
  )
  const refs = db
    .prepare(`SELECT voucher_id AS voucherId, kind, name, amount FROM bill_refs WHERE party_ledger_id = ? AND voucher_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`)
    .all(partyId, ...ids) as { voucherId: number; kind: 'new' | 'against'; name: string; amount: number }[]
  const by = new Map<number, string[]>()
  for (const r of refs) {
    const list = by.get(r.voucherId) ?? []
    list.push(t(r.kind === 'new' ? 'simple.print.alloc.new' : 'simple.print.alloc.against', { name: r.name, amount: rupees(r.amount) }))
    by.set(r.voucherId, list)
  }
  return rows.map((r) => ({
    ...r,
    voucherType: t(KIND_WORD[kinds.get(r.voucherId) ?? ''] ?? 'simple.print.kind.other'),
    allocation: by.get(r.voucherId)?.join(' · ') ?? (r.credit > 0 ? t('simple.print.alloc.oldest') : '')
  }))
}

async function writePdf(dir: string, file: string, html: string, db: DB, kind: 'statement' | 'reminder'): Promise<string> {
  mkdirSync(dir, { recursive: true })
  const pdf = await htmlToPdf(html, { ...pdfOptionsFor(resolveTemplate(db, kind)), pageLabel: printLocale(db).opts.labels?.page })
  const path = join(dir, file)
  writeFileSync(path, pdf)
  return path
}

export async function statementPdf(db: DB, company: CompanyInfo, slug: string, ledgerId: number, from: string, to: string, dir?: string): Promise<StatementPdfResult> {
  const { html, data } = statementHtml(db, company, ledgerId, from, to)
  const path = await writePdf(dir ?? join(companyExportsDir(slug), 'statements'), `statement-${safeName(data.party.name)}-${to}.pdf`, html, db, 'statement')
  writeAudit(db, 'export', 0, 'export', null, { kind: 'statement', ledgerId, from, to, path })
  return { path, mailto: data.email.mailto, subject: data.email.subject, body: data.email.body }
}

/** Every debtor with a balance as on `to` (or the given parties) → one PDF each in `dir`
 *  (default exports/statements-<to>/). */
export async function statementsBulk(db: DB, company: CompanyInfo, slug: string, from: string, to: string, opts: { dir?: string; ledgerIds?: number[] } = {}): Promise<StatementsBulkResult> {
  const folder = opts.dir ?? join(companyExportsDir(slug), `statements-${to}`)
  const wanted = opts.ledgerIds ? new Set(opts.ledgerIds) : null
  const files: StatementsBulkResult['files'] = []
  for (const p of debtorRows(db)) {
    if (wanted && !wanted.has(p.id)) continue
    const { html, data } = statementHtml(db, company, p.id, from, to)
    if (!wanted && data.closing === 0) continue
    const path = await writePdf(folder, `statement-${safeName(p.name)}-${to}.pdf`, html, db, 'statement')
    files.push({ ledgerId: p.id, name: p.name, path, closing: data.closing })
  }
  writeAudit(db, 'export', 0, 'export', null, { kind: 'statements', from, to, folder, count: files.length })
  return { folder, files }
}

// ---------------------------------------------------------------- reminders

const overdueOf = (p: OutstandingParty): OutstandingBill[] => p.bills.filter((b) => b.overdueDays > 0 && b.pending > 0)

function lastReminders(db: DB): Map<number, { date: string; bucket: ReminderBucket }> {
  const rows = db
    .prepare(
      `SELECT r.party_ledger_id AS id, r.date, r.bucket FROM reminder_log r
       WHERE r.id = (SELECT r2.id FROM reminder_log r2 WHERE r2.party_ledger_id = r.party_ledger_id ORDER BY r2.date DESC, r2.id DESC LIMIT 1)`
    )
    .all() as { id: number; date: string; bucket: ReminderBucket }[]
  return new Map(rows.map((r) => [r.id, { date: r.date, bucket: r.bucket }]))
}

function candidateOf(p: OutstandingParty, party: PartyRow, cfg: ReceivablesConfig, last: { date: string; bucket: ReminderBucket } | undefined, asOn: string): ReminderCandidate | null {
  const overdue = overdueOf(p)
  if (!overdue.length) return null
  const oldest = [...overdue].sort((a, b) => b.overdueDays - a.overdueDays)[0]!
  const bucket = reminderBucketFor(oldest.overdueDays, cfg)!
  const cadence = reminderCadence(last?.date ?? null, asOn, cfg.minDaysBetweenReminders)
  return {
    ledgerId: p.ledgerId, name: p.name, email: party.email, bucket,
    overdue: overdue.reduce((s, b) => s + b.pending, 0), total: p.pending, billCount: overdue.length,
    oldestBill: oldest.number, oldestBillDate: oldest.date, maxOverdueDays: oldest.overdueDays,
    lastSent: last?.date ?? null, lastBucket: last?.bucket ?? null, allowed: cadence.allowed, nextAllowed: cadence.nextAllowed
  }
}

/** Debtors with overdue bills as on `asOn`, each with its letter (by the oldest bill's days
 *  overdue) and whether the cadence allows another reminder yet. */
export function reminderCandidates(db: DB, asOn: string): ReminderCandidate[] {
  const cfg = getReceivablesConfig(db)
  const last = lastReminders(db)
  const out: ReminderCandidate[] = []
  for (const p of outstandings(db, 'receivable', asOn)) {
    const c = candidateOf(p, partyRow(db, p.ledgerId), cfg, last.get(p.ledgerId), asOn)
    if (c) out.push(c)
  }
  return out.sort((a, b) => b.maxOverdueDays - a.maxOverdueDays || b.overdue - a.overdue)
}

export const REMINDER_CADENCE_PREFIX = 'Reminder cadence:'

/** The letter for one party: subject + body merged, split at a `{bills}` line for the PDF table. */
function reminderLetter(cfg: ReceivablesConfig, company: CompanyInfo, party: PartyRow, p: OutstandingParty, bucket: ReminderBucket, asOn: string) {
  const overdue = overdueOf(p)
  const fields = reminderFields({ company: company.name, party: party.name, asOn, overdue, totalPending: p.pending })
  const tpl = cfg.reminders[bucket]
  const subject = mergeTemplate(tpl.subject, fields)
  const body = mergeTemplate(tpl.body, fields)
  const lines = tpl.body.split('\n')
  const at = lines.findIndex((l) => l.trim() === '{bills}')
  const bodyBefore = at >= 0 ? mergeTemplate(lines.slice(0, at).join('\n'), fields) : body
  const bodyAfter = at >= 0 ? mergeTemplate(lines.slice(at + 1).join('\n'), fields) : ''
  return { subject, body, bodyBefore, bodyAfter, bills: at >= 0 ? overdue : null, overdue: overdue.reduce((s, b) => s + b.pending, 0) }
}

export interface ReminderLogInsert {
  party_ledger_id: number
  bucket: ReminderBucket
  date: string
  amount_paise: number
  oldest_bill: string | null
  max_overdue_days: number
  document_path: string | null
  channel: ReminderLogChannel
}

/** Log one sent reminder (reminder_log + its audit row) — the letter above, and the simple
 *  People screen's WhatsApp / SMS / copied message (WP 9.8, no document). `extra` rides in the
 *  audit row only. */
export function logReminder(db: DB, r: ReminderLogInsert, extra: Record<string, unknown> = {}): number {
  const row = { ...r, user_name: currentAuditUserName() }
  const logId = Number(
    db
      .prepare(
        `INSERT INTO reminder_log (party_ledger_id, bucket, date, amount_paise, oldest_bill, max_overdue_days, document_path, channel, user_name)
         VALUES (@party_ledger_id, @bucket, @date, @amount_paise, @oldest_bill, @max_overdue_days, @document_path, @channel, @user_name)`
      )
      .run(row).lastInsertRowid
  )
  writeAudit(db, 'reminder', logId, 'create', null, { ...row, ...extra })
  return logId
}

const BUCKET_HEAD: Record<ReminderBucket, string> = { gentle: 'Reminder', firm: 'Second reminder', final: 'Final notice' }
/** WP 10.4: the same heads in the company language (a localised simple-mode print only). */
const REMINDER_HEAD_KEY = { gentle: 'simple.print.reminder.gentle', firm: 'simple.print.reminder.firm', final: 'simple.print.reminder.final' } as const satisfies Record<ReminderBucket, MessageKey>

/** Render, save and log one reminder. Refused inside the cadence window unless `force`. */
export async function remind(
  db: DB, company: CompanyInfo, slug: string,
  q: { ledgerId: number; asOn: string; channel: ReminderChannel; force?: boolean }
): Promise<ReminderResult> {
  const cfg = getReceivablesConfig(db)
  const party = partyRow(db, q.ledgerId)
  const p = outstandings(db, 'receivable', q.asOn).find((x) => x.ledgerId === q.ledgerId)
  const cand = p ? candidateOf(p, party, cfg, lastReminders(db).get(q.ledgerId), q.asOn) : null
  if (!p || !cand) throw new Error(`Nothing is overdue for ${party.name} as on ${toDisplayDate(q.asOn)}`)
  if (!cand.allowed && !q.force) {
    throw new Error(`${REMINDER_CADENCE_PREFIX} ${party.name} was reminded on ${toDisplayDate(cand.lastSent!)} — the next reminder is due from ${toDisplayDate(cand.nextAllowed!)}`)
  }
  const letter = reminderLetter(cfg, company, party, p, cand.bucket, q.asOn)
  const doc: ReminderDocument = {
    shape: 'reminder', kind: 'reminder', company,
    reminder: {
      date: q.asOn, bucketLabel: BUCKET_HEAD[cand.bucket], party: { name: party.name, address: party.address, gstin: party.gstin },
      subject: letter.subject, bodyBefore: letter.bodyBefore, bills: letter.bills, bodyAfter: letter.bodyAfter, overdue: letter.overdue
    }
  }
  const locale = printLocale(db)
  if (locale.lang !== 'en') doc.reminder.bucketLabel = companyT(db)(REMINDER_HEAD_KEY[cand.bucket])
  const html = renderDocument(locale.template(resolveTemplate(db, 'reminder')), doc, locale.opts)
  const path = await writePdf(join(companyExportsDir(slug), 'reminders'), `reminder-${cand.bucket}-${safeName(party.name)}-${q.asOn}.pdf`, html, db, 'reminder')
  const logId = logReminder(db, {
    party_ledger_id: q.ledgerId, bucket: cand.bucket, date: q.asOn, amount_paise: cand.overdue, oldest_bill: cand.oldestBill,
    max_overdue_days: cand.maxOverdueDays, document_path: path, channel: q.channel
  }, { forced: !!q.force && !cand.allowed })
  return {
    logId, ledgerId: q.ledgerId, name: party.name, bucket: cand.bucket, path, subject: letter.subject, body: letter.body,
    mailto: mailtoLink(party.email, letter.subject, letter.body)
  }
}

/** Bulk generation: every candidate (or the given parties) the cadence allows; the rest are
 *  reported as skipped with the reason. */
export async function remindBulk(db: DB, company: CompanyInfo, slug: string, q: { asOn: string; ledgerIds?: number[]; channel: ReminderChannel }): Promise<ReminderBulkResult> {
  const wanted = q.ledgerIds ? new Set(q.ledgerIds) : null
  const sent: ReminderResult[] = []
  const skipped: ReminderBulkResult['skipped'] = []
  for (const c of reminderCandidates(db, q.asOn)) {
    if (wanted && !wanted.has(c.ledgerId)) continue
    if (!c.allowed) {
      skipped.push({ ledgerId: c.ledgerId, name: c.name, reason: `Reminded on ${toDisplayDate(c.lastSent!)}; next from ${toDisplayDate(c.nextAllowed!)}` })
      continue
    }
    sent.push(await remind(db, company, slug, { ledgerId: c.ledgerId, asOn: q.asOn, channel: q.channel }))
  }
  return { sent, skipped }
}

export function reminderLog(db: DB, from: string, to: string, ledgerId?: number): ReminderLogRow[] {
  return db
    .prepare(
      `SELECT r.id, r.party_ledger_id AS ledgerId, l.name AS partyName, r.bucket, r.date, r.amount_paise AS amount, r.oldest_bill AS oldestBill,
              r.max_overdue_days AS days, r.document_path AS documentPath, r.channel, r.user_name AS userName, r.created_at AS createdAt
       FROM reminder_log r JOIN ledgers l ON l.id = r.party_ledger_id
       WHERE r.date BETWEEN ? AND ? ${ledgerId ? 'AND r.party_ledger_id = ?' : ''}
       ORDER BY r.date DESC, r.id DESC`
    )
    .all(from, to, ...(ledgerId ? [ledgerId] : [])) as ReminderLogRow[]
}

// ---------------------------------------------------------------- credit control

export function setCreditHold(db: DB, ledgerId: number, hold: boolean, reason: string): { hold: boolean; reason: string | null; at: string | null } {
  const before = partyRow(db, ledgerId)
  const at = hold ? new Date().toISOString() : null
  const r = hold ? reason.trim() : null
  db.prepare('UPDATE ledgers SET credit_hold = ?, credit_hold_reason = ?, credit_hold_at = ? WHERE id = ?').run(hold ? 1 : 0, r, at, ledgerId)
  writeAudit(db, 'credit_hold', ledgerId, 'update',
    { ledger: before.name, hold: !!before.hold, reason: before.holdReason, at: before.holdAt },
    { ledger: before.name, hold, reason: r, at })
  return { hold, reason: r, at }
}

function balancesAsOn(db: DB, asOn: string): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT vl.ledger_id AS id, SUM(CASE WHEN vl.dr_cr = 'dr' THEN vl.amount ELSE -vl.amount END) AS m
       FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id WHERE v.date <= ? AND ${IN_BOOKS} GROUP BY vl.ledger_id`
    )
    .all(asOn) as { id: number; m: number }[]
  return new Map(rows.map((r) => [r.id, r.m]))
}

interface LatestPromise { date: string; amount: number | null }

/** The latest follow-up carrying a promise, per bill key. */
function latestPromises(db: DB): Map<string, LatestPromise & { ledgerId: number; id: number }> {
  const rows = db
    .prepare(
      `SELECT id, party_ledger_id AS ledgerId, bill_voucher_id AS billVoucherId, bill_ref AS billRef, promised_date AS date, promised_amount AS amount
       FROM bill_followups WHERE promised_date IS NOT NULL ORDER BY date, id`
    )
    .all() as { id: number; ledgerId: number; billVoucherId: number | null; billRef: string; date: string; amount: number | null }[]
  const out = new Map<string, LatestPromise & { ledgerId: number; id: number }>()
  for (const r of rows) out.set(`${r.ledgerId}#${billKeyOf(r)}`, { date: r.date, amount: r.amount, ledgerId: r.ledgerId, id: r.id })
  return out
}

/** Debtors by exposure: balance, overdue, open sales orders, limit utilisation, trailing 90-day
 *  DSO, hold status, the next promised payment and the last reminder. */
export function creditControl(db: DB, asOn: string): CreditControlRow[] {
  const bal = balancesAsOn(db, asOn)
  const os = new Map(outstandings(db, 'receivable', asOn).map((p) => [p.ledgerId, p]))
  const windowFrom = addDaysIso(asOn, -89)
  const sales = new Map<number, number>()
  for (const r of registerVoucherRows(db, 'sales', windowFrom, asOn)) if (r.partyLedgerId != null) sales.set(r.partyLedgerId, (sales.get(r.partyLedgerId) ?? 0) + r.total)
  const promises = latestPromises(db)
  const last = lastReminders(db)
  const rows: CreditControlRow[] = []
  for (const p of debtorRows(db)) {
    const outstanding = (bal.get(p.id) ?? 0) + p.openingBalance
    const party = os.get(p.id)
    if (outstanding === 0 && !party && !p.hold && p.creditLimit == null) continue
    const overdueBills = party ? overdueOf(party) : []
    const openOrders = openSalesOrderValue(db, p.id)
    const exposure = Math.max(0, outstanding) + openOrders
    // Next promise on a still-open bill: the earliest on/after asOn, else the latest broken one.
    const open = new Set((party?.bills ?? []).map((b) => `${p.id}#${billKeyOf({ billVoucherId: b.voucherId, billRef: b.number })}`))
    const mine = [...promises.entries()].filter(([k]) => open.has(k)).map(([, v]) => v)
    const next = mine.filter((x) => x.date >= asOn).sort((a, b) => a.date.localeCompare(b.date))[0] ?? mine.sort((a, b) => b.date.localeCompare(a.date))[0]
    rows.push({
      ledgerId: p.id, name: p.name, outstanding, overdue: overdueBills.reduce((s, b) => s + b.pending, 0), openOrders, exposure,
      creditLimit: p.creditLimit, utilisation: p.creditLimit ? Math.round((exposure / p.creditLimit) * 10_000) / 10_000 : null,
      dso: partyDso(Math.max(0, outstanding), sales.get(p.id) ?? 0, 90),
      maxOverdueDays: overdueBills.reduce((m, b) => Math.max(m, b.overdueDays), 0),
      hold: !!p.hold, holdReason: p.holdReason, holdAt: p.holdAt,
      promisedDate: next?.date ?? null, promisedAmount: next?.amount ?? null, lastReminder: last.get(p.id)?.date ?? null
    })
  }
  return rows.sort((a, b) => b.exposure - a.exposure)
}

// ---------------------------------------------------------------- follow-ups

const FOLLOWUP_SQL = `SELECT f.id, f.party_ledger_id AS ledgerId, l.name AS partyName, f.bill_voucher_id AS billVoucherId, f.bill_ref AS billRef,
  f.date, f.note, f.promised_date AS promisedDate, f.promised_amount AS promisedAmount, f.user_name AS userName, f.created_at AS createdAt
  FROM bill_followups f JOIN ledgers l ON l.id = f.party_ledger_id`

export function addFollowup(db: DB, raw: FollowupInput): FollowupRow {
  const f = followupInputSchema.parse(raw)
  partyRow(db, f.ledgerId)
  const id = Number(
    db
      .prepare('INSERT INTO bill_followups (party_ledger_id, bill_voucher_id, bill_ref, date, note, promised_date, promised_amount, user_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(f.ledgerId, f.billVoucherId, f.billRef, f.date, f.note, f.promisedDate, f.promisedAmount, currentAuditUserName()).lastInsertRowid
  )
  const row = db.prepare(`${FOLLOWUP_SQL} WHERE f.id = ?`).get(id) as FollowupRow
  writeAudit(db, 'bill_followup', id, 'create', null, row)
  return row
}

export function deleteFollowup(db: DB, id: number): void {
  const before = db.prepare(`${FOLLOWUP_SQL} WHERE f.id = ?`).get(id) as FollowupRow | undefined
  if (!before) throw new Error('Follow-up not found')
  db.prepare('DELETE FROM bill_followups WHERE id = ?').run(id)
  writeAudit(db, 'bill_followup', id, 'delete', before, null)
}

export function listFollowups(db: DB, ledgerId?: number): FollowupRow[] {
  return db.prepare(`${FOLLOWUP_SQL} ${ledgerId ? 'WHERE f.party_ledger_id = ?' : ''} ORDER BY f.date DESC, f.id DESC`).all(...(ledgerId ? [ledgerId] : [])) as FollowupRow[]
}

/** Monday..Sunday of the week containing `date`. */
export function weekOf(date: string): { from: string; to: string } {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7 // 0 = Monday
  const from = addDaysIso(date, -dow)
  return { from, to: addDaysIso(from, 6) }
}

/** Promises falling due this week (Mon–Sun) on bills still open as on `today`, latest promise per
 *  bill; `overdueCount` = promises dated before today whose bill is still open (broken). */
export function promisedThisWeek(db: DB, today: string): PromisedSummary {
  const week = weekOf(today)
  const pending = new Map<string, number>()
  for (const p of outstandings(db, 'receivable', today)) {
    for (const b of p.bills) if (b.pending > 0) pending.set(`${p.ledgerId}#${billKeyOf({ billVoucherId: b.voucherId, billRef: b.number })}`, b.pending)
  }
  const latest = latestPromises(db)
  const ids: { id: number; stillPending: number }[] = []
  let overdueCount = 0
  for (const [k, v] of latest) {
    const still = pending.get(k)
    if (still === undefined) continue
    if (v.date >= week.from && v.date <= week.to) ids.push({ id: v.id, stillPending: still })
    else if (v.date < today) overdueCount++
  }
  const stmt = db.prepare(`${FOLLOWUP_SQL} WHERE f.id = ?`)
  const rows = ids.map(({ id, stillPending }) => ({ ...(stmt.get(id) as FollowupRow), stillPending })).sort((a, b) => (a.promisedDate ?? '').localeCompare(b.promisedDate ?? ''))
  return {
    weekFrom: week.from, weekTo: week.to, count: rows.length,
    amount: rows.reduce((s, r) => s + Math.min(r.promisedAmount ?? r.stillPending, r.stillPending), 0),
    overdueCount, rows
  }
}

// ---------------------------------------------------------------- collection reports

/** Net credit sales per month on debtors: sales + debit notes − credit notes (party-line totals). */
function salesByMonth(db: DB, from: string, to: string): Map<string, number> {
  const debtors = partyGroupIdsBySide(db, 'debtor')
  const rows = db
    .prepare(
      `SELECT substr(v.date, 1, 7) AS month, vt.kind, l.group_id AS groupId, vl.dr_cr AS drCr, vl.amount
       FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id JOIN voucher_lines vl ON vl.voucher_id = v.id
       JOIN ledgers l ON l.id = vl.ledger_id
       WHERE vt.kind IN ('sales', 'debit_note', 'credit_note') AND v.date BETWEEN ? AND ? AND vl.ledger_id = v.party_ledger_id AND ${IN_BOOKS}`
    )
    .all(from, to) as { month: string; kind: string; groupId: number; drCr: 'dr' | 'cr'; amount: number }[]
  const out = new Map<string, number>()
  for (const r of rows) {
    if (!debtors.has(r.groupId)) continue
    out.set(r.month, (out.get(r.month) ?? 0) + (r.drCr === 'dr' ? r.amount : -r.amount))
  }
  return out
}

function receivablesAt(db: DB, asOn: string): { total: number; notDue: number; buckets: [number, number, number, number] } {
  const parties = outstandings(db, 'receivable', asOn)
  const bills = parties.flatMap((p) => p.bills)
  return {
    total: bills.reduce((s, b) => s + b.pending, 0),
    notDue: bills.filter((b) => b.overdueDays === 0).reduce((s, b) => s + b.pending, 0),
    buckets: ageingBuckets(bills)
  }
}

/** Month by month: DSO, collection efficiency (received ÷ due) and the ageing at month end. */
export function collectionReport(db: DB, from: string, to: string): CollectionReport {
  const months = monthsBetween(from, to)
  const sales = salesByMonth(db, monthStartIso(months[0] ?? from.slice(0, 7)), to)
  let opening = receivablesAt(db, addDaysIso(monthStartIso(months[0] ?? from.slice(0, 7)), -1)).total
  const out: CollectionReport['months'] = []
  for (const m of months) {
    const end = monthEndIso(m) > to ? to : monthEndIso(m)
    const at = receivablesAt(db, end)
    out.push({ ...collectionMonth({ month: m, opening, sales: sales.get(m) ?? 0, closing: at.total, closingNotDue: at.notDue, days: Number(end.slice(8, 10)) }), buckets: at.buckets })
    opening = at.total
  }
  return { months: out }
}

export function topOverdue(db: DB, asOn: string, limit: number): TopOverdueRow[] {
  const lastReceipt = new Map(
    (
      db
        .prepare(
          `SELECT vl.ledger_id AS id, MAX(v.date) AS d FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id JOIN voucher_types vt ON vt.id = v.voucher_type_id
           WHERE vt.kind = 'receipt' AND vl.dr_cr = 'cr' AND v.date <= ? AND ${IN_BOOKS} GROUP BY vl.ledger_id`
        )
        .all(asOn) as { id: number; d: string }[]
    ).map((r) => [r.id, r.d])
  )
  const cc = new Map(creditControl(db, asOn).map((r) => [r.ledgerId, r]))
  return outstandings(db, 'receivable', asOn)
    .map((p): TopOverdueRow | null => {
      const od = overdueOf(p)
      if (!od.length) return null
      const oldest = [...od].sort((a, b) => b.overdueDays - a.overdueDays)[0]!
      return {
        ledgerId: p.ledgerId, name: p.name, overdue: od.reduce((s, b) => s + b.pending, 0), total: p.pending, maxOverdueDays: oldest.overdueDays,
        oldestBill: oldest.number, billCount: od.length, lastReceiptDate: lastReceipt.get(p.ledgerId) ?? null,
        promisedDate: cc.get(p.ledgerId)?.promisedDate ?? null, hold: cc.get(p.ledgerId)?.hold ?? false
      }
    })
    .filter((r): r is TopOverdueRow => r !== null)
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, limit)
}
