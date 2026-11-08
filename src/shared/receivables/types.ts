/** WP 4.2 — result shapes of the receivables channels (src/main/ipcReceivables.ts). */
import type { OutstandingBill } from '../reports'
import type { CollectionMonth } from './collections'
import type { ReminderBucket, ReminderLogChannel } from './config'

/** A bill's identity across the computed outstandings: its voucher (null = the opening balance)
 *  and its name (bill-ref name or voucher number). */
export interface BillKey {
  billVoucherId: number | null
  billRef: string
}
export const billKeyOf = (k: BillKey): string => `${k.billVoucherId ?? 'o'}|${k.billRef}`

export interface StatementParty {
  id: number
  name: string
  address: string | null
  gstin: string | null
  email: string | null
}

export interface StatementRow {
  voucherId: number
  date: string
  voucherType: string
  number: string
  particulars: string
  narration: string | null
  debit: number
  credit: number
  /** Signed running balance, positive = Dr (the ledger statement's). */
  running: number
  /** Bill-wise allocation of the voucher ("New ref INV-7 · Agst ref INV-3"); '' when none. */
  allocation: string
}

export interface StatementBank {
  name: string
  account: string
  ifsc: string
  branch: string
}

export interface StatementData {
  party: StatementParty
  from: string
  to: string
  opening: number
  closing: number
  totalDebit: number
  totalCredit: number
  rows: StatementRow[]
  /** Open bills as on `to` (the Outstandings allocation). */
  openBills: OutstandingBill[]
  /** Ageing of the open bills by days overdue. */
  buckets: [number, number, number, number]
  /** Receipts not matched to any bill (an advance), paise. */
  unapplied: number
  paymentRequest: string
  bank: StatementBank | null
  email: { subject: string; body: string; mailto: string }
}

export interface StatementPdfResult {
  path: string
  mailto: string
  subject: string
  body: string
}

export interface StatementsBulkResult {
  folder: string
  files: { ledgerId: number; name: string; path: string; closing: number }[]
  /** Folder picker cancelled. */
  cancelled?: boolean
}

export interface ReminderCandidate {
  ledgerId: number
  name: string
  email: string | null
  bucket: ReminderBucket
  overdue: number
  total: number
  billCount: number
  oldestBill: string
  oldestBillDate: string
  maxOverdueDays: number
  lastSent: string | null
  lastBucket: ReminderBucket | null
  /** Inside the "don't remind again within N days" window. */
  allowed: boolean
  nextAllowed: string | null
}

export interface ReminderResult {
  logId: number
  ledgerId: number
  name: string
  bucket: ReminderBucket
  path: string
  subject: string
  body: string
  mailto: string
}

export interface ReminderBulkResult {
  sent: ReminderResult[]
  skipped: { ledgerId: number; name: string; reason: string }[]
}

export interface ReminderLogRow {
  id: number
  ledgerId: number
  partyName: string
  bucket: ReminderBucket
  date: string
  amount: number
  oldestBill: string | null
  days: number
  documentPath: string | null
  channel: ReminderLogChannel
  userName: string | null
  createdAt: string
}

/** A bill's STABLE identity (WP 4.2 review; once the interest feature's key, still what
 *  `interest_charges.bill_key` and the receivables bill keys hold): its voucher — plus which of the
 *  voucher's new bill refs when it carries several — so renumbering the invoice or renaming its
 *  bill ref never makes a charged bill look uncharged; the ref name only for opening-balance bills. */
export function stableBillKey(billVoucherId: number | null, billRef: string, newRefsOfVoucher: readonly string[] = []): string {
  if (billVoucherId == null) return `o:${billRef}`
  if (newRefsOfVoucher.length <= 1) return `v:${billVoucherId}`
  const i = newRefsOfVoucher.indexOf(billRef)
  return `v:${billVoucherId}#${i >= 0 ? i : billRef}`
}

export interface CreditControlRow {
  ledgerId: number
  name: string
  outstanding: number
  overdue: number
  openOrders: number
  exposure: number
  creditLimit: number | null
  /** exposure ÷ limit (null without a limit). */
  utilisation: number | null
  /** Trailing 90-day DSO; null with no sales in the window. */
  dso: number | null
  maxOverdueDays: number
  hold: boolean
  holdReason: string | null
  holdAt: string | null
  promisedDate: string | null
  promisedAmount: number | null
  lastReminder: string | null
}

export interface FollowupRow extends BillKey {
  id: number
  ledgerId: number
  partyName: string
  date: string
  note: string
  promisedDate: string | null
  promisedAmount: number | null
  userName: string | null
  createdAt: string
}

export interface PromisedSummary {
  weekFrom: string
  weekTo: string
  count: number
  amount: number
  /** Promises dated before today on bills still open (broken). */
  overdueCount: number
  rows: (FollowupRow & { stillPending: number })[]
}

export interface CollectionReportMonth extends CollectionMonth {
  buckets: [number, number, number, number]
}

export interface CollectionReport {
  months: CollectionReportMonth[]
}

export interface TopOverdueRow {
  ledgerId: number
  name: string
  overdue: number
  total: number
  maxOverdueDays: number
  oldestBill: string
  billCount: number
  lastReceiptDate: string | null
  promisedDate: string | null
  hold: boolean
}
