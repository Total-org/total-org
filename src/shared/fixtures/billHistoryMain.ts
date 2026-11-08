// FROZEN REFERENCE — `billHistory` from src/shared/cashForecast.ts exactly as on origin/main
// 643fd574 (before audit A1, PR #233). billHistoryDifferential.test.ts checks the live function
// against it on generated event lists. Never edit this file to make that test pass.
/* eslint-disable */
import type { BillEvent } from '../outstanding'

export function addDaysISO(date: string, delta: number): string {
  const dt = new Date(date + 'T00:00:00Z')
  dt.setUTCDate(dt.getUTCDate() + delta)
  return dt.toISOString().slice(0, 10)
}

export interface HistoryBill {
  /** Due date, or the bill date when the bill had no terms. */
  dueBasis: string
  settledOn: string | null
  amount: number
}

export function billHistory(events: readonly BillEvent[], creditDays: number | null): HistoryBill[] {
  interface OpenBill { name: string; dueBasis: string; amount: number; pending: number; rec: HistoryBill }
  const open: OpenBill[] = []
  const out: HistoryBill[] = []
  let credit = 0
  const due = (date: string, explicit: string | null): string => explicit ?? (creditDays != null ? addDaysISO(date, creditDays) : date)
  const add = (name: string, date: string, amount: number, explicitDue: string | null): void => {
    const rec: HistoryBill = { dueBasis: due(date, explicitDue), settledOn: null, amount }
    out.push(rec)
    const take = Math.min(credit, amount)
    credit -= take
    const b: OpenBill = { name, dueBasis: rec.dueBasis, amount, pending: amount - take, rec }
    if (b.pending > 0) open.push(b)
    else rec.settledOn = date
  }
  const settle = (idx: number, amount: number, date: string): number => {
    const b = open[idx]!
    const take = Math.min(b.pending, amount)
    b.pending -= take
    if (b.pending === 0) {
      b.rec.settledOn = date
      open.splice(idx, 1)
    }
    return amount - take
  }
  const fifo = (amount: number, date: string): void => {
    let rest = amount
    while (rest > 0 && open.length) rest = settle(0, rest, date)
    credit += rest
  }
  for (const ev of events) {
    if (ev.refs.length > 0) {
      for (const r of ev.refs) {
        if (r.kind === 'new') add(r.name, ev.date, r.amount, r.dueDate)
        else {
          const idx = open.findIndex((b) => b.name === r.name)
          if (idx === -1) credit += r.amount
          else {
            const rest = settle(idx, r.amount, ev.date)
            if (rest > 0) fifo(rest, ev.date)
          }
        }
      }
    } else if (ev.amount > 0) add(ev.number, ev.date, ev.amount, null)
    else if (ev.amount < 0) fifo(-ev.amount, ev.date)
  }
  return out
}
