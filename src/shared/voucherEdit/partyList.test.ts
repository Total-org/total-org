import { describe, expect, it } from 'vitest'
import { DEFAULT_GROUPS } from '../seed'
import { partyPickerLedgers, partyRank, type PartyListGroup } from './partyList'

// The seeded chart (ids by position) plus an imported "Trade Receivables" root with a sub-group,
// an expense group that happens to be called "Creditors" (not a party root: wrong nature).
const groups: PartyListGroup[] = DEFAULT_GROUPS.map((g, i) => ({ id: i + 1, name: g.name, parentId: null, nature: g.nature }))
const idOf = (name: string): number => groups.find((g) => g.name === name)!.id
for (const [i, g] of DEFAULT_GROUPS.entries()) if (g.parent) groups[i]!.parentId = idOf(g.parent)
groups.push({ id: 100, name: 'Trade Receivables', parentId: null, nature: 'asset' })
groups.push({ id: 101, name: 'Mumbai dealers', parentId: 100, nature: 'asset' })
groups.push({ id: 102, name: 'Creditors', parentId: idOf('Indirect Expenses'), nature: 'expense' })

// The masters list comes sorted by name — the audit's screenshot order (UX-3).
const ledgers = [
  { id: 1, name: 'Bharat Steel Suppliers', groupId: idOf('Sundry Creditors') },
  { id: 2, name: 'Cash', groupId: idOf('Cash-in-Hand') },
  { id: 3, name: 'CGST Input', groupId: idOf('Duties & Taxes'), taxType: 'cgst' },
  { id: 4, name: 'CGST Output', groupId: idOf('Duties & Taxes'), taxType: 'cgst' },
  { id: 5, name: 'Courier charges', groupId: 102 },
  { id: 6, name: 'Gujarat Components', groupId: idOf('Sundry Creditors') },
  { id: 7, name: 'HDFC Bank', groupId: idOf('Bank Accounts') },
  { id: 8, name: 'HDFC OD', groupId: idOf('Bank OD A/c') },
  { id: 9, name: 'Kumar Retail', groupId: idOf('Sundry Debtors') },
  { id: 10, name: 'Loan from Ravi', groupId: idOf('Unsecured Loans') },
  { id: 11, name: 'Mehta & Sons', groupId: 101 },
  { id: 12, name: 'Owner capital', groupId: idOf('Capital Account') },
  { id: 13, name: 'Round Off', groupId: idOf('Indirect Expenses') },
  { id: 14, name: 'Sales', groupId: idOf('Sales Accounts') },
  { id: 15, name: 'TDS payable', groupId: idOf('Duties & Taxes') },
  { id: 16, name: 'Zenith Traders', groupId: idOf('Sundry Debtors') }
]
const names = (ls: { name: string }[]): string[] => ls.map((l) => l.name)

describe('party picker list (audit A8 / UX-3)', () => {
  it('a sale lists customers, then cash / bank, then suppliers, then other balance-sheet ledgers — never tax, income or expense', () => {
    expect(names(partyPickerLedgers(ledgers, groups, 'sales'))).toEqual([
      'Kumar Retail', 'Mehta & Sons', 'Zenith Traders',
      'Cash', 'HDFC Bank', 'HDFC OD',
      'Bharat Steel Suppliers', 'Gujarat Components',
      'Loan from Ravi', 'Owner capital'
    ])
  })

  it('a purchase puts suppliers first and customers after cash / bank', () => {
    expect(names(partyPickerLedgers(ledgers, groups, 'purchase'))).toEqual([
      'Bharat Steel Suppliers', 'Gujarat Components',
      'Cash', 'HDFC Bank', 'HDFC OD',
      'Kumar Retail', 'Mehta & Sons', 'Zenith Traders',
      'Loan from Ravi', 'Owner capital'
    ])
  })

  it('recently used parties come first within their rank, newest first', () => {
    const list = names(partyPickerLedgers(ledgers, groups, 'sales', [16, 7, 11]))
    expect(list.slice(0, 6)).toEqual(['Zenith Traders', 'Mehta & Sons', 'Kumar Retail', 'HDFC Bank', 'Cash', 'HDFC OD'])
  })

  it('the party a saved bill already names stays in the list, last', () => {
    const list = partyPickerLedgers(ledgers, groups, 'sales', [], 14)
    expect(list.at(-1)?.name).toBe('Sales')
    expect(partyPickerLedgers(ledgers, groups, 'sales').some((l) => l.id === 14)).toBe(false)
  })

  it('an imported party root counts by its role; an expense group named "Creditors" does not', () => {
    const byId = new Map(groups.map((g) => [g.id, g]))
    expect(partyRank(ledgers[10]!, byId, 'sales')).toBe(0)
    expect(partyRank(ledgers[10]!, byId, 'purchase')).toBe(2)
    expect(partyRank(ledgers[4]!, byId, 'purchase')).toBeNull()
  })
})
