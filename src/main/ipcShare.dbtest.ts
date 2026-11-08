// A10 — the share / UPI channels through registerIpc(): strict payloads, a sales bill's PDF
// written + shown in Finder (WhatsApp / e-mail ways — the links themselves are opened by the
// renderer) or handed to the macOS share sheet, a receipt refused, (audited as an export —
// auditCoverage), and the UPI ID set through `upi:set` (a bad one refused on its field).
import { TRUSTED_EVENT } from './ipcSender.testutil'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string; code?: string; field?: string }>>()
const shown: string[] = []
const sheets: { filePaths?: string[]; texts?: string[] }[] = []

vi.mock('electron', () => ({
  app: { getVersion: () => '0.0.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: (ch: string, fn: (e: unknown, p: unknown) => Promise<{ ok: boolean }>) => handlers.set(ch.replace(/^total:/, ''), fn) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) },
  shell: { openPath: async () => '', showItemInFolder: (p: string) => void shown.push(p) },
  Notification: class {},
  BrowserWindow: class {
    static getFocusedWindow = () => null
    static getAllWindows = () => []
  },
  ShareMenu: class {
    constructor(private item: { filePaths?: string[]; texts?: string[] }) {}
    popup(): void {
      sheets.push(this.item)
    }
  },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./updater', () => ({ checkForUpdatesInteractive: async () => null }))
// No Chromium in a dbtest: the PDF is the HTML's bytes, written where the real one goes.
vi.mock('./services/pdf', () => ({
  htmlToPdf: async (html: string) => Buffer.from(html),
  writePdfFile: async (path: string, html: string) => (writeFileSync(path, html), path),
  writeExportPdf: async (slug: string, name: string, html: string) => {
    const { companyExportsDir } = await import('./paths')
    const path = join(companyExportsDir(slug), name)
    writeFileSync(path, html)
    return path
  }
}))

process.env.TOTAL_DATA_DIR = mkdtempSync(join(tmpdir(), 'total-share-ipc-'))
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'

async function call<T = unknown>(channel: string, payload?: unknown): Promise<{ ok: boolean; data?: T; error?: string; code?: string; field?: string }> {
  return (await handlers.get(channel)!(TRUSTED_EVENT, payload)) as { ok: boolean; data?: T; error?: string; code?: string; field?: string }
}
async function ok<T = unknown>(channel: string, payload?: unknown): Promise<T> {
  const r = await call<T>(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error}`)
  return r.data as T
}

const ipcModule = await import('./ipc')
let bill = 0
let receipt = 0

beforeAll(async () => {
  ipcModule.registerIpc()
  const { slug } = await ok<{ slug: string }>('company:create', {
    name: 'Share Co', stateCode: '27', gstin: null, gstRegistrationType: 'unregistered', address: 'Pune',
    booksFrom: 2026, email: null, phone: null, pan: null, tan: null
  })
  await ok('company:open', { slug })
  const groups = await ok<{ id: number; name: string }[]>('master:groups:list')
  const g = (n: string) => groups.find((x) => x.name === n)!.id
  const party = (await ok<{ id: number }>('master:ledgers:create', { name: 'Asha', groupId: g('Sundry Debtors'), phone: '9876543210' })).id
  const sales = (await ok<{ id: number }>('master:ledgers:create', { name: 'Sales', groupId: g('Sales Accounts') })).id
  const cash = (await ok<{ id: number }[] & { name: string }[]>('master:ledgers:list') as unknown as { id: number; name: string }[]).find((l) => l.name === 'Cash')!.id
  const types = await ok<{ id: number; kind: string }[]>('master:voucherTypes:list')
  const vt = (k: string) => types.find((t) => t.kind === k)!.id
  const save = async (kind: string, partyId: number | null, lines: { ledgerId: number; drCr: 'dr' | 'cr'; amount: number }[]) =>
    (await ok<{ id: number }>('voucher:save', {
      data: { voucherTypeId: vt(kind), date: '2026-07-05', partyLedgerId: partyId, reference: null, narration: null, lines: lines.map((l) => ({ ...l, costAllocations: [] })), inventory: [], billRefs: [], tds: null }
    })).id
  bill = await save('sales', party, [{ ledgerId: party, drCr: 'dr', amount: 250000 }, { ledgerId: sales, drCr: 'cr', amount: 250000 }])
  receipt = await save('receipt', null, [{ ledgerId: cash, drCr: 'dr', amount: 50000 }, { ledgerId: party, drCr: 'cr', amount: 50000 }])
})

describe('share a bill (A10)', () => {
  it('facts: ₹2,500 bill − ₹500 received = ₹2,000 due; the UPI ID only once set', async () => {
    expect(await ok('invoice:shareFacts', { voucherId: bill })).toMatchObject({ shareable: true, totalPaise: 250000, duePaise: 200000, whatsapp: '9876543210', upiId: null })
    const bad = await call('upi:set', { upiId: 'asha' })
    expect(bad).toMatchObject({ ok: false, code: 'upi_invalid', field: 'upiId' })
    expect(await ok('upi:set', { upiId: 'Share.Co@YBL' })).toEqual({ upiId: 'share.co@ybl' })
    expect(await ok('upi:get')).toEqual({ upiId: 'share.co@ybl' })
    expect(await ok('invoice:shareFacts', { voucherId: bill })).toMatchObject({ upiId: 'share.co@ybl' })
    expect((await call('upi:set', { upiId: 'x@ybl', extra: 1 })).ok).toBe(false)
  })
  it('whatsapp / e-mail: the PDF is written and shown in Finder; the sheet gets the PDF + message', async () => {
    const w = await ok<{ path: string; sheet: boolean }>('invoice:share', { voucherId: bill, via: 'whatsapp' })
    expect(existsSync(w.path)).toBe(true)
    expect(shown.at(-1)).toBe(w.path)
    expect(w.sheet).toBe(false)
    const s = await ok<{ path: string; sheet: boolean }>('invoice:share', { voucherId: bill, via: 'sheet', text: 'Hello Asha' })
    if (process.platform === 'darwin') {
      expect(s.sheet).toBe(true)
      expect(sheets.at(-1)).toEqual({ filePaths: [s.path], texts: ['Hello Asha'] })
    } else {
      expect(s.sheet).toBe(false)
      expect(shown.at(-1)).toBe(s.path)
    }
  })
  it('refuses a receipt, an unknown way and extra keys', async () => {
    expect(await call('invoice:share', { voucherId: receipt, via: 'email' })).toMatchObject({ ok: false, code: 'share_not_bill' })
    expect((await call('invoice:share', { voucherId: bill, via: 'sms' })).ok).toBe(false)
    expect((await call('invoice:share', { voucherId: bill, via: 'email', to: 'x@y.z' })).ok).toBe(false)
  })
})
