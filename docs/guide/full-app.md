# The full app (for accountants)

The full app is Total's accountant mode: Tally-style double-entry books, keyboard-first. It works
on the same books as the simple screens. The owner turns it on for a business in **Settings → How
Total looks**, or open one screen through **Accountant view**.

## Entering

- **Vouchers**: sales, purchase, receipt, payment, contra, journal, credit / debit notes, stock
  journal, physical stock, manufacture. Item mode or accounting (ledger-line) mode; bill-wise
  allocation, cost centres and TDS where turned on. ⌘↵ saves; Save comes first in the tab order.
- **Masters**: ledgers and groups, stock items, units, godowns, price levels, BOMs. A picker never
  creates on Enter — ↓ past the last match reaches **Create…**.
- **Trade cycle** (when used): quotations, orders, delivery challans and goods receipt notes,
  linked line by line to the bills raised against them.
- **Imports**: Tally XML, Excel / books import with undo, bank statements (CSV / Excel, MT940, CAMT.053, pasted text).

## Reading

- **Reports**: trial balance, P&L, balance sheet (with comparisons), cash flow, ratios, stock
  summary and movements, Outstandings with ageing, ledger statements, Registers → All entries.
  Every figure is computed from the entries at the moment you ask — nothing is stored.
- **GST**: GSTR-1, GSTR-3B, GSTR-9 workings, GSTR-2B reconciliation, HSN summary, JSON exports
  for the portal, e-invoice / e-way bill JSON (live NIC filing is experimental).
- **Analysis → Checks**: the month-end close checklist, unusual entries, exception reports, stale
  trade documents, GSTR-2B mismatches.
- **CA pack**: the year's reports and registers as files for your auditor.

## Control

- **Audit trail** (the edit log, MCA rule 3(1)): every change is kept with its before and after,
  in a hash chain that shows any tampering. Deleted entries go to the **Bin** and can be restored.
- **Lock date** and the **year-end close** (a closing journal per year; bin it to reopen).
- **Settings → Users** (People & roles on the simple screens): owner / accountant / viewer, with per-person limits (no posting, no profit
  figures, no exports).
- **Backups**: automatic and on demand; every backup you take, and the newest automatic one each
  day, is checked to restore; encrypted `.totalbak` exports for
  moving books to another computer.

## Keys

⌘K palette (commands, ledgers, entries by name / number / GSTIN / amount) · ⌘J Assistant (Ask Total, then the AI helper if set up) · ⌘O switch
business · ⌘L lock · Esc closes the top panel, then goes back. On
Windows, Ctrl for ⌘ and Alt for ⌥.
