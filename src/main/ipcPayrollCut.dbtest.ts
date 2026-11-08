// Audit A13b — payroll PF / ESI / PT removed: the PF / ESI / PT channels (rates, PT states, the
// ECR / ESI / PT files, the PT summary) are no longer registered; salary TDS channels stay.
// payroll:payments:record takes a PF / ESI / PT payment only for a due an old run (saved before
// the cut) left outstanding — owner, 8 Nov 2026 — and payroll:dues lists those beside the TDS rows.
import { TRUSTED_EVENT } from './ipcSender.testutil'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { testFileDb } from './db/testdb'

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string; code?: string }>>()

vi.mock('electron', () => ({
  app: { getVersion: () => '0.12.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: (ch: string, fn: (e: unknown, p: unknown) => Promise<{ ok: boolean }>) => handlers.set(ch.replace(/^total:/, ''), fn) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', showItemInFolder: () => {} },
  Notification: class {},
  BrowserWindow: class {},
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./updater', () => ({ checkForUpdatesInteractive: async () => null }))

const DATA_DIR = mkdtempSync(join(tmpdir(), 'total-payroll-cut-ipc-'))
process.env.TOTAL_DATA_DIR = DATA_DIR
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'

async function call(channel: string, payload?: unknown): Promise<{ ok: boolean; data?: unknown; error?: string; code?: string }> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`no handler ${channel}`)
  return h(TRUSTED_EVENT, payload)
}
async function ok<T>(channel: string, payload?: unknown): Promise<T> {
  const r = await call(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error}`)
  return r.data as T
}

// WP 7.3: the ipc module graph is imported at collection, not inside the hook.
const ipc = await import('./ipc')

beforeAll(() => {
  ipc.registerIpc()
})

describe('payroll IPC after the PF / ESI / PT cut', () => {
  it('the PF / ESI / PT channels are gone; the salary TDS ones stay', () => {
    for (const ch of ['payroll:rates:list', 'payroll:rates:save', 'payroll:rates:delete', 'payroll:ptStates', 'payroll:ptReturnCsv', 'payroll:ecr', 'payroll:esi', 'payroll:ptCsv', 'payroll:ptSummary']) {
      expect(handlers.has(ch), ch).toBe(false)
      expect(ipc.CHANNEL_ROLES.has(ch), ch).toBe(false)
    }
    for (const ch of ['payroll:dues', 'payroll:payments:list', 'payroll:payments:record', 'payroll:payments:delete', 'payroll:declarations:set', 'payroll:workings', 'payroll:form16', 'payroll:form16Pdf', 'tds:form24q', 'tds:form24qCsv']) {
      expect(handlers.has(ch), ch).toBe(true)
    }
  })

  it('payroll:payments:record refuses a PF / ESI / PT payment no old run left a due for, before writing anything', async () => {
    const { slug } = await ok<{ slug: string }>('company:create', {
      name: 'Payroll Cut Co', stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null
    })
    await ok('company:open', { slug })
    const ledgers = await ok<{ id: number; name: string }[]>('master:ledgers:list')
    const cash = ledgers.find((l) => l.name === 'Cash')!.id
    const before = (await ok<unknown[]>('voucher:list', { from: '2026-04-01', to: '2027-03-31' })).length
    const pay = { period: '2026-07', state: null, amountPaise: 1_000_00, paidOn: '2026-08-10', bankLedgerId: cash, reference: null, bsrCode: null, challanNo: null }
    for (const kind of ['pf', 'esi', 'pt']) {
      const r = await call('payroll:payments:record', { ...pay, kind, state: kind === 'pt' ? 'MH' : null })
      expect(r.ok, kind).toBe(false)
      expect(r.error, kind).toMatch(/is left to pay for 2026-07/)
    }
    // An unknown kind is refused by Zod.
    expect(await call('payroll:payments:record', { ...pay, kind: 'gratuity' })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect((await ok<unknown[]>('voucher:list', { from: '2026-04-01', to: '2027-03-31' })).length).toBe(before)
    expect(await ok<unknown[]>('payroll:payments:list', { fyStartYear: 2026 })).toEqual([])
    // A salary TDS payment still records (a Payment voucher against the TDS 192 payable).
    const tds = await ok<{ kind: string; amountPaise: number }>('payroll:payments:record', { ...pay, kind: 'tds' })
    expect(tds).toMatchObject({ kind: 'tds', amountPaise: 1_000_00 })
    expect(await ok<unknown[]>('payroll:dues', { fyStartYear: 2026 })).toEqual([])
    await ok('company:close')
  })

  it('an old run\'s PF due is listed, can be marked paid, and then leaves the list', async () => {
    const { slug } = await ok<{ slug: string }>('company:create', {
      name: 'Old PF Co', stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null
    })
    await ok('company:close')
    // The rows as the old commitRun wrote them (no service writes them any more): one employee,
    // July 2026, basic 20,000 — PF 1,800 employee + 1,800 employer = ₹3,600 (no EDLI / admin, to
    // keep the figure plain), no ESI / PT. Journal: Salaries Dr 21,800 = PF Payable Cr 3,600 +
    // Salaries Payable Cr 18,200.
    const db = testFileDb(join(DATA_DIR, 'companies', slug, 'company.db'))
    const g = (name: string): number => (db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number }).id
    const led = (name: string, group: string, kind: string | null): number =>
      Number(db.prepare('INSERT INTO ledgers (name, group_id, is_system, statutory_kind) VALUES (?, ?, 0, ?)').run(name, g(group), kind).lastInsertRowid)
    const salaries = (db.prepare("SELECT id FROM ledgers WHERE name = 'Salaries'").get() as { id: number } | undefined)?.id ?? led('Salaries', 'Indirect Expenses', null)
    const pfPayable = led('PF Payable', 'Provisions', 'pf')
    const salPayable = led('Salaries Payable', 'Provisions', 'salary')
    const journal = (db.prepare("SELECT id FROM voucher_types WHERE kind = 'journal' AND is_system = 1").get() as { id: number }).id
    const vId = Number(db.prepare("INSERT INTO vouchers (voucher_type_id, number, date, narration) VALUES (?, 'J-1', '2026-07-31', 'Salary for 2026-07 — 1 employee')").run(journal).lastInsertRowid)
    const vl = db.prepare('INSERT INTO voucher_lines (voucher_id, ledger_id, dr_cr, amount, line_order) VALUES (?, ?, ?, ?, ?)')
    vl.run(vId, salaries, 'dr', 21_800_00, 1); vl.run(vId, pfPayable, 'cr', 3_600_00, 2); vl.run(vId, salPayable, 'cr', 18_200_00, 3)
    const empId = Number(db.prepare("INSERT INTO employees (name, basic, pt_state) VALUES ('Old Hand', 2000000, 'MH')").run().lastInsertRowid)
    const runId = Number(db.prepare("INSERT INTO payroll_runs (month, voucher_id, pf_admin_topup) VALUES ('2026-07', ?, 0)").run(vId).lastInsertRowid)
    db.prepare(
      `INSERT INTO payroll_lines (run_id, employee_id, payable_days, month_days, basic, hra, special, gross, pf_emp, pf_er, esi_emp, esi_er, pt, net, eps_er, edli, epf_wage, eps_wage, edli_wage)
       VALUES (?, ?, 31, 31, 2000000, 0, 0, 2000000, 180000, 180000, 0, 0, 0, 1820000, 124950, 0, 1500000, 1500000, 1500000)`
    ).run(runId, empId)
    db.close()
    await ok('company:open', { slug })
    const cash = (await ok<{ id: number; name: string }[]>('master:ledgers:list')).find((l) => l.name === 'Cash')!.id
    // Listed beside the (empty) TDS rows: PF July ₹3,600, due 15 August.
    const dues = await ok<{ key: string; kind: string; payablePaise: number; outstandingPaise: number; dueDate: string }[]>('payroll:dues', { fyStartYear: 2026 })
    expect(dues.map((d) => [d.key, d.payablePaise, d.outstandingPaise, d.dueDate])).toEqual([['pf:2026-07', 3_600_00, 3_600_00, '2026-08-15']])
    // Part paid: still listed with what is left, and the payment with it.
    const first = await ok<{ id: number; kind: string }>('payroll:payments:record', { kind: 'pf', period: '2026-07', state: null, amountPaise: 1_600_00, paidOn: '2026-08-10', bankLedgerId: cash, reference: 'ECR July', bsrCode: null, challanNo: null })
    expect(first.kind).toBe('pf')
    expect((await ok<{ outstandingPaise: number }[]>('payroll:dues', { fyStartYear: 2026 })).map((d) => d.outstandingPaise)).toEqual([2_000_00])
    expect((await ok<{ id: number }[]>('payroll:payments:list', { fyStartYear: 2026 })).map((p) => p.id)).toEqual([first.id])
    // The rest clears it: the due (and its payments) leave the list; a further one is refused.
    await ok('payroll:payments:record', { kind: 'pf', period: '2026-07', state: null, amountPaise: 2_000_00, paidOn: '2026-08-12', bankLedgerId: cash, reference: null, bsrCode: null, challanNo: null })
    expect(await ok<unknown[]>('payroll:dues', { fyStartYear: 2026 })).toEqual([])
    expect(await ok<unknown[]>('payroll:payments:list', { fyStartYear: 2026 })).toEqual([])
    expect((await call('payroll:payments:record', { kind: 'pf', period: '2026-07', state: null, amountPaise: 100, paidOn: '2026-08-12', bankLedgerId: cash, reference: null, bsrCode: null, challanNo: null })).error).toMatch(/No EPF is left/)
    // The PF payable is nil in the trial balance: Cr 3,600, Dr 1,600 + 2,000.
    const tb = await ok<{ rows: { ledgerName: string; debit: number; credit: number }[] }>('report:trialBalance', { asOn: '2026-08-31' })
    expect(tb.rows.find((r) => r.ledgerName === 'PF Payable')).toMatchObject({ debit: 0, credit: 0 })
  })
})
