// Audit A13b — payroll PF / ESI / PT removed: payroll:payments:record takes salary TDS only (Zod,
// before anything is written), and the PF / ESI / PT channels (rates, PT states, the ECR / ESI /
// PT files, the PT summary) are no longer registered. Salary TDS channels stay.
import { TRUSTED_EVENT } from './ipcSender.testutil'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

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

process.env.TOTAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'total-payroll-cut-ipc-'))
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

  it('payroll:payments:record refuses kind pf / esi / pt before writing anything', async () => {
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
      expect(r.code, kind).toBe('invalid_input')
    }
    expect((await ok<unknown[]>('voucher:list', { from: '2026-04-01', to: '2027-03-31' })).length).toBe(before)
    expect(await ok<unknown[]>('payroll:payments:list', { fyStartYear: 2026 })).toEqual([])
    // A salary TDS payment still records (a Payment voucher against the TDS 192 payable).
    const tds = await ok<{ kind: string; amountPaise: number }>('payroll:payments:record', { ...pay, kind: 'tds' })
    expect(tds).toMatchObject({ kind: 'tds', amountPaise: 1_000_00 })
    expect(await ok<unknown[]>('payroll:dues', { fyStartYear: 2026 })).toEqual([])
  })
})
