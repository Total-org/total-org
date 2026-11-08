import type { DB } from '../db/connection'
import type { CompanyInfo } from '@shared/domain'
import type { BillShareFacts } from '@shared/billShare'
import { billAmount } from '@shared/simple/saveCard'
import { AppError } from '@shared/errors'
import { NOT_DELETED } from './vouchers'
import { billDueOn, getUpiSettings } from './upiSettings'
import { counterAccounts, WALK_IN_NAME } from './counter'

// A10 (audit 2026-11 PROD-7): what the share buttons need to know about one bill. Read only.

const SHAREABLE_KINDS = new Set(['sales', 'credit_note'])

export function billShareFacts(db: DB, company: CompanyInfo, voucherId: number, today: string, platform: string = process.platform): BillShareFacts {
  const v = db
    .prepare(
      `SELECT v.id, v.number, v.date, vt.kind, v.party_ledger_id AS partyId
       FROM vouchers v JOIN voucher_types vt ON vt.id = v.voucher_type_id
       WHERE v.id = ? AND ${NOT_DELETED}`
    )
    .get(voucherId) as { id: number; number: string; date: string; kind: string; partyId: number | null } | undefined
  if (!v) throw new AppError('voucher_not_found', 'Voucher not found')
  const lines = db.prepare('SELECT ledger_id AS ledgerId, dr_cr AS drCr, amount FROM voucher_lines WHERE voucher_id = ?').all(voucherId) as {
    ledgerId: number; drCr: 'dr' | 'cr'; amount: number
  }[]
  const party = v.partyId != null
    ? (db.prepare('SELECT name, phone, whatsapp, email FROM ledgers WHERE id = ?').get(v.partyId) as { name: string; phone: string | null; whatsapp: string | null; email: string | null } | undefined)
    : undefined
  // A walk-in sale ("Cash sale", the counter's account): the buyer is not that account — the
  // message greets nobody by name and there is no number / address to send to.
  const walkIn = party != null && (v.partyId === counterAccounts(db).walkInLedgerId || party.name === WALK_IN_NAME)
  const contact = walkIn ? undefined : party
  const total = billAmount(lines, v.partyId)
  const sale = v.kind === 'sales'
  const due = sale ? billDueOn(db, v.partyId, v.id, total, today) : 0
  const upiId = sale && due > 0 ? getUpiSettings(db).upiId : null
  return {
    voucherId: v.id,
    kind: v.kind,
    shareable: SHAREABLE_KINDS.has(v.kind),
    number: v.number,
    date: v.date,
    partyName: contact?.name ?? null,
    whatsapp: contact?.whatsapp?.trim() || contact?.phone?.trim() || null,
    email: contact?.email?.trim() || null,
    totalPaise: total,
    duePaise: due,
    upiId,
    businessName: company.name,
    shareSheet: platform === 'darwin'
  }
}
