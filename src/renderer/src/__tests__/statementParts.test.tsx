// R7 / FIG-B-2: the balance sheet's "Profit & Loss A/c" line carries `parts` (Opening balance,
// Current period). The statement screen, its PDF / CSV rows and the comparative view show them
// beneath the line; a line with children shows its children as before.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { statementChildren, type StatementNode } from '@shared/reports'
import { StatementTree } from '../components/StatementTree'
import { amountIndex, unionTrees } from '../components/ComparativeStatement'
import { flattenNodes } from '../lib/reportExport'

const node = (id: number, name: string, amount: number, extra: Partial<StatementNode> = {}): StatementNode =>
  ({ id, kind: 'computed', name, amount, children: [], ...extra })

const PARTS = [node(-6, 'Opening balance', 15_000_00), node(-7, 'Current period', 5_000_00)]
const PROFIT = node(-3, 'Profit & Loss A/c', 20_000_00, { parts: PARTS })
const GROUP = node(10, 'Capital Account', 7_000_00, { kind: 'group', children: [node(11, 'Capital', 7_000_00, { kind: 'ledger' })] })

beforeEach(() => {
  window.total = { platform: 'test', invoke: vi.fn(async () => ({ ok: false, error: 'unmocked' })) }
})
afterEach(() => cleanup())

function renderTree(nodes: StatementNode[], expandAll = false): void {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StatementTree nodes={nodes} expandAll={expandAll} hideZero={false} />
    </QueryClientProvider>
  )
}

describe('statementChildren', () => {
  it('children first, else the parts of a split line, else nothing', () => {
    expect(statementChildren(GROUP)).toEqual(GROUP.children)
    expect(statementChildren(PROFIT)).toEqual(PARTS)
    expect(statementChildren(node(-4, 'Difference in Opening Balances', 1))).toEqual([])
  })
})

describe('the statement screen', () => {
  it('shows the two parts under the profit line (open, like any top-level line) and folds them with the line', () => {
    renderTree([PROFIT])
    const line = screen.getByRole('button', { name: /Profit & Loss A\/c/ })
    expect(line.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Opening balance')).toBeTruthy()
    expect(screen.getByText('Current period')).toBeTruthy()
    fireEvent.click(line)
    expect(screen.queryByText('Opening balance')).toBeNull()
  })

  it('a line with neither children nor parts has no arrow; a group still shows its ledgers', () => {
    renderTree([node(-4, 'Difference in Opening Balances', 1), GROUP])
    expect(screen.getByRole('button', { name: /Difference in Opening Balances/ }).getAttribute('aria-expanded')).toBeNull()
    const capital = screen.getByRole('button', { name: /Capital Account/ })
    expect(capital.getAttribute('aria-expanded')).toBe('true')
    expect(within(screen.getByTestId('statement-ledger')).getByText('Capital')).toBeTruthy()
  })
})

describe('PDF / CSV rows', () => {
  it('the parts follow their line, one step in', () => {
    const rows = flattenNodes([PROFIT])
    expect(rows.map((r) => [r.cells[0], r.indent])).toEqual([['Profit & Loss A/c', 0], ['Opening balance', 1], ['Current period', 1]])
    expect(rows.map((r) => r.cells[1])).toEqual(['20,000.00', '15,000.00', '5,000.00'])
  })
})

describe('the comparative view', () => {
  it('merges the parts of each column under the line by name, amounts from the first column', () => {
    const last = node(-3, 'Profit & Loss A/c', 15_000_00, { parts: [node(-6, 'Opening balance', 0), node(-7, 'Current period', 15_000_00)] })
    const merged = unionTrees([[PROFIT], [last]])
    expect(merged).toHaveLength(1)
    expect(merged[0]!.children.map((c) => [c.name, c.amount])).toEqual([['Opening balance', 15_000_00], ['Current period', 5_000_00]])
    const lastYear = amountIndex([last])
    expect([...lastYear.values()]).toEqual([15_000_00, 0, 15_000_00])
  })
})
