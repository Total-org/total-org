// IPC channels for banking: bank ledgers, reconciliation, CSV import, bank rules, BRS. Registered from
// ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed here,
// every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the
// handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { dialog } from 'electron'
import { readFileSync } from 'fs'
import { decodeTextFile } from '@shared/textFiles'
import { z } from 'zod'
import { slugify } from './paths'
import { bankRuleInputSchema, isoDate, periodSchema } from '@shared/schemas'
import { formatPaise } from '@shared/money'
import * as banking from './services/banking'
import { writeExportPdf } from './services/pdf'
import { reportHtml } from './services/reportHtml'
import { auditExport, idSchema, type IpcContext, type IpcHandle } from './ipcCommon'

export function registerBankRecoIpc(handle: IpcHandle, { requireCompany }: IpcContext): void {
  // ---------- banking ----------
  handle('bank:ledgers', () => banking.bankLedgers(requireCompany().db), 'viewer')
  handle('bank:recon', (p) => {
    const { ledgerId, from, to } = periodSchema.extend({ ledgerId: z.number().int().positive() }).parse(p)
    return banking.bankRecon(requireCompany().db, ledgerId, from, to)
  }, 'viewer')
  handle('bank:setBankDate', (p) => {
    const { lineId, bankDate } = z.object({ lineId: z.number().int().positive(), bankDate: z.string().nullable() }).parse(p)
    banking.setBankDate(requireCompany().db, lineId, bankDate)
    return null
  })
  handle('bank:importCsv', async (p) => {
    const { ledgerId, csvText, dryRun } = z
      .object({ ledgerId: z.number().int().positive(), csvText: z.string().optional(), dryRun: z.boolean().optional() })
      .parse(p)
    const c = requireCompany()
    let csv = csvText
    if (csv === undefined) {
      const picked = await dialog.showOpenDialog({
        title: 'Choose bank statement CSV',
        filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
        properties: ['openFile']
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      csv = decodeTextFile(readFileSync(picked.filePaths[0]))
    }
    // csvText rides back on the response (not just the parsed result) so the renderer — which
    // never sees the picked file's contents when the dialog path is used — can hand the exact
    // same text to banking:suggest (or back to an applying import after a dryRun preview).
    return { ...banking.importStatement(c.db, ledgerId, csv, { apply: !dryRun }), csvText: csv }
  })
  handle('bankrule:list', () => banking.listRules(requireCompany().db), 'viewer')
  handle('bankrule:save', (p) => {
    const { id, data } = z.object({ id: z.number().int().positive().optional(), data: bankRuleInputSchema }).parse(p)
    return banking.saveRule(requireCompany().db, data, id)
  })
  handle('bankrule:delete', (p) => {
    banking.deleteRule(requireCompany().db, idSchema.parse(p).id)
    return null
  })
  handle('bankrule:hit', (p) => {
    banking.recordRuleHit(requireCompany().db, idSchema.parse(p).id)
    return null
  })
  handle('banking:suggest', (p) => {
    const { ledgerId, csvText } = z.object({ ledgerId: z.number().int().positive(), csvText: z.string() }).parse(p)
    return banking.suggestVouchers(requireCompany().db, ledgerId, csvText)
  })
  // statement matching v2 — read-only tolerance/many-to-one suggestions (task Y2)
  handle('banking:matchSuggestions', (p) => {
    const { ledgerId, csvText, tolerancePaise } = z
      .object({
        ledgerId: z.number().int().positive(),
        csvText: z.string(),
        tolerancePaise: z.number().int().min(0).max(100_00).optional()
      })
      .parse(p)
    return banking.matchSuggestions(requireCompany().db, ledgerId, csvText, tolerancePaise ?? 100)
  }, 'viewer')
  // bank reconciliation statement (task Y2)
  const brsSchema = z.object({ ledgerId: z.number().int().positive(), asOn: isoDate })
  handle('banking:brs', (p) => {
    const { ledgerId, asOn } = brsSchema.parse(p)
    return banking.brs(requireCompany().db, ledgerId, asOn)
  }, 'viewer')
  handle('banking:brsPdf', async (p) => {
    const { ledgerId, asOn } = brsSchema.parse(p)
    const c = requireCompany()
    const r = banking.brs(c.db, ledgerId, asOn)
    const money = (paise: number): string => formatPaise(paise)
    const item = (i: banking.BrsItem): { cells: string[]; indent?: number } => ({
      cells: [i.date, `${i.voucherType} ${i.number}`, i.instrumentNo ?? '', i.particulars, money(i.amount)],
      indent: 1
    })
    const rows = [
      { cells: ['', 'Balance as per company books', '', '', money(r.bookBalance)], bold: true },
      { cells: ['', 'Less: deposits not yet credited by the bank', '', '', ''], bold: true },
      ...r.uncredited.map(item),
      { cells: ['', 'Total uncredited', '', '', money(r.uncreditedTotal)], rule: true },
      { cells: ['', 'Add: cheques issued but not yet presented', '', '', ''], bold: true },
      ...r.unpresented.map(item),
      { cells: ['', 'Total unpresented', '', '', money(r.unpresentedTotal)], rule: true },
      { cells: ['', 'Balance as per bank statement', '', '', money(r.bankBalance)], bold: true, rule: true }
    ]
    const html = reportHtml({
      title: 'Bank Reconciliation Statement',
      company: c.info,
      periodLabel: `${r.ledgerName} · as on ${asOn}`,
      columns: [
        { label: 'Date', align: 'l', width: 90 },
        { label: 'Voucher', align: 'l', width: 140 },
        { label: 'Instrument', align: 'l', width: 100 },
        { label: 'Particulars', align: 'l' },
        { label: 'Amount', align: 'r', width: 110 }
      ],
      rows
    })
    const path = await writeExportPdf(c.slug, `brs-${slugify(r.ledgerName)}-${asOn}.pdf`, html, { pageSize: 'A4' })
    auditExport(c.db, 'brs_pdf', { ledgerId, asOn, path })
    return { path }
  }, 'viewer')
}
