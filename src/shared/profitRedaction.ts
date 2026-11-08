// WP 7.2 — a user whose `canSeeProfit` flag is off still gets the dashboards and simple Home; the
// profit figures in them are left out (never shown as ₹0). Pure.
import type { DashboardData, LedgerBalanceRow, TrialBalance } from './reports'
import type { DashboardSeries } from './dashboard'
import type { SimpleHomeData } from './simple/home'
import type { ChartGroupNode } from './chartOfAccounts'
import type { CostSheet, ProductionRegisterRow } from './manufactureReports'

export const PROFIT_HIDDEN_MESSAGE = 'Profit figures are not shown to your account'

export function redactDashboard(d: DashboardData): DashboardData {
  // Audit A3: the stock turnover is the cost of goods sold over the average stock — with the
  // stock values (Stock summary) and the sales it gives the gross profit back.
  return { ...d, ratios: { ...d.ratios, grossMarginPct: null, netMarginPct: null, inventoryTurnover: null } }
}

export function redactDashboardSeries(d: DashboardSeries): DashboardSeries {
  return { ...d, trade: { ok: false, error: PROFIT_HIDDEN_MESSAGE } }
}

const zeroPeriod = <T extends { netProfit: number; lines: unknown; topExpense: unknown }>(p: T): T => ({
  ...p,
  netProfit: 0,
  openingStock: 0,
  closingStock: 0,
  lines: { ...(p.lines as object), ...Object.fromEntries(Object.keys(p.lines as object).map((k) => [k, 0])) },
  topExpense: null
})

export function redactHome(h: SimpleHomeData): SimpleHomeData {
  return {
    ...h,
    profitHidden: true,
    profit: {
      month: zeroPeriod(h.profit.month),
      year: zeroPeriod(h.profit.year),
      previousMonth: { ...h.profit.previousMonth, lines: zeroPeriod({ netProfit: 0, lines: h.profit.previousMonth.lines, topExpense: null }).lines }
    }
  }
}

/** The ledgerId the trial balance gives its computed "Profit & Loss A/c (opening)" row. */
export const TB_PRIOR_PNL_ROW_ID = -5

/** The trial balance without what adds up to the profit: the income / expense ledgers
 *  (`pnlLedgerIds`) and the computed prior-years P&L row are left out, and the totals are 0 with
 *  `profitHidden` set — a Dr / Cr total over the remaining rows would show the profit as their
 *  difference, so no total is given (never a wrong number: the screen shows the note instead). */
export function redactTrialBalance(tb: TrialBalance, pnlLedgerIds: ReadonlySet<number>): TrialBalance {
  return {
    rows: tb.rows.filter((r) => r.ledgerId !== TB_PRIOR_PNL_ROW_ID && !pnlLedgerIds.has(r.ledgerId)),
    totalDebit: 0,
    totalCredit: 0,
    openingDebitTotal: 0,
    openingCreditTotal: 0,
    movementDebitTotal: 0,
    movementCreditTotal: 0,
    profitHidden: true
  }
}

/** Audit A3: Masters → Groups without what adds up to the profit — the income / expense groups'
 *  totals and their ledgers' balances are withheld (`balanceHidden`, 0); every name, count and
 *  asset / liability balance stays (it is a list of masters). */
export function redactChartOfAccounts(nodes: ChartGroupNode[], pnlLedgerIds: ReadonlySet<number>): ChartGroupNode[] {
  return nodes.map((g) => {
    const hide = g.nature === 'income' || g.nature === 'expense'
    return {
      ...g,
      ...(hide ? { balance: 0, balanceHidden: true as const } : {}),
      children: redactChartOfAccounts(g.children, pnlLedgerIds),
      ledgers: g.ledgers.map((l) => (hide || pnlLedgerIds.has(l.id) ? { ...l, balance: 0, balanceHidden: true as const } : l))
    }
  })
}

/** Audit A3: ledger balances without the income / expense ledgers (`pnlLedgerIds`). */
export function redactLedgerBalances(rows: LedgerBalanceRow[], pnlLedgerIds: ReadonlySet<number>): LedgerBalanceRow[] {
  return rows.filter((r) => !pnlLedgerIds.has(r.ledgerId))
}

/** Audit A3: the production register without its sale value and margin (cost and quantities stay;
 *  the cost sheet's item list reads it). The screen hides the two columns. */
export function redactProductionRows(rows: ProductionRegisterRow[]): ProductionRegisterRow[] {
  return rows.map((r) => ({ ...r, saleAmount: 0, marginPaise: 0, marginPct: null }))
}

/** Audit A3: a cost sheet without the sale value typed on the manufacture (cost − sale = margin). */
export function redactCostSheet<T extends CostSheet>(sheet: T): T {
  return { ...sheet, saleAmount: 0 }
}

/** What the AI tools and Ask Total say when a profit figure is withheld. */
export const PROFIT_HIDDEN_TOOL_MESSAGE =
  'Profit figures are not shown to this user’s account (the owner turned “can see profit” off). Tell the user plainly that profit, the balance sheet and P&L figures are not available to them and that the owner can change it in People & roles.'
