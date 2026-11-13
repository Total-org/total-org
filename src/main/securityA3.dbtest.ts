// Audit A3 (docs/audit/2026-11-audit.md SEC-3, SEC-8, SEC-11, SEC-12, SEC-13) through the IPC
// handlers (electron mocked; a scratch TOTAL_DATA_DIR):
//  - canSeeProfit: false — every channel the sweep found that handed out profit is refused or
//    leaves the profit out, one test per channel, with hand-worked figures; owners see them all;
//  - company:open / company:forgetRemembered take only a business on this computer's list;
//  - a business without people locked with a passphrase can't be deleted at its privacy screen,
//    and its delete always asks for the passphrase even while its key is in memory;
//  - the PIN lockout grows with every further wrong PIN;
//  - the agent mirror's auto-refresh follows the saving user's flag, and a passphrase-locked
//    business gets no plaintext mirror.
import { TRUSTED_EVENT } from './ipcSender.testutil'
import { describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type Result = { ok: boolean; data?: unknown; error?: string; code?: string; field?: string }
const handlers = new Map<string, (event: unknown, payload: unknown) => Promise<Result>>()

vi.mock('electron', () => ({
  app: { getVersion: () => '0.12.0-test', getPath: () => tmpdir(), isPackaged: false, on: () => {} },
  ipcMain: { handle: (ch: string, fn: (e: unknown, p: unknown) => Promise<Result>) => handlers.set(ch.replace(/^total:/, ''), fn) },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  shell: { openPath: async () => '', showItemInFolder: () => {}, openExternal: async () => {} },
  Notification: class {},
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('./updater', () => ({ checkForUpdatesInteractive: async () => null }))

const DATA_DIR = mkdtempSync(join(tmpdir(), 'total-security-a3-'))
process.env.TOTAL_DATA_DIR = DATA_DIR
process.env.TOTAL_SUPPRESS_SYNC_WARNING = '1'
process.env.TOTAL_INSECURE_TEST_SECRETS = '1'

// WP 7.3: the ipc module graph is imported at collection, never inside a hook.
const ipc = await import('./ipc')
const agentBridge = await import('./services/agentBridge')
const users = await import('./services/users')
ipc.registerIpc()

async function call(channel: string, payload?: unknown): Promise<Result> {
  const h = handlers.get(channel)
  if (!h) throw new Error(`no handler ${channel}`)
  return h(TRUSTED_EVENT, payload)
}
async function ok<T>(channel: string, payload?: unknown): Promise<T> {
  const r = await call(channel, payload)
  if (!r.ok) throw new Error(`${channel}: ${r.error} (${r.code ?? ''})`)
  return r.data as T
}
const company = (name: string): Record<string, unknown> => ({
  name, stateCode: '27', gstin: null, gstRegistrationType: 'regular', address: '', booksFrom: 2026, email: null, phone: null, pan: null, tan: null
})
const ledgerInput = (name: string, groupId: number): Record<string, unknown> => ({
  name, groupId, openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null
})

describe('canSeeProfit: false — the doors the audit sweep found (A3)', () => {
  const PIN = { owner: '1111', acct: '2222' }
  let ids: { owner: number; acct: number }
  let led: { sales: number; rent: number; cash: number }
  let chair = 0
  const asOwner = (): Promise<unknown> => ok('auth:login', { userId: ids.owner, pin: PIN.owner })
  const asAcct = (): Promise<unknown> => ok('auth:login', { userId: ids.acct, pin: PIN.acct })
  // FY 2025-26: over by now, so the owner can close it.
  const FY = { from: '2025-04-01', to: '2026-03-31' }

  it('sets up: ₹50,000 of sales, ₹20,000 rent, one Chair made for ₹600 valued at ₹1,000', async () => {
    const { slug } = await ok<{ slug: string }>('company:create', { ...company('A3 Profit Co'), booksFrom: 2025 })
    await ok('company:open', { slug })
    const owner = await ok<{ id: number }>('users:save', { data: { name: 'Owner', role: 'owner', pin: PIN.owner } })
    const acct = await ok<{ id: number }>('users:save', { data: { name: 'Asha', role: 'accountant', pin: PIN.acct, capabilities: { canSeeProfit: false } } })
    ids = { owner: owner.id, acct: acct.id }
    await asOwner()
    const groups = new Map((await ok<{ id: number; name: string }[]>('master:groups:list')).map((g) => [g.name, g.id]))
    const sales = await ok<{ id: number }>('master:ledgers:create', ledgerInput('Counter Sales', groups.get('Sales Accounts')!))
    const rent = await ok<{ id: number }>('master:ledgers:create', ledgerInput('Rent', groups.get('Indirect Expenses')!))
    const cash = (await ok<{ id: number; name: string }[]>('master:ledgers:list')).find((l) => l.name === 'Cash')!
    led = { sales: sales.id, rent: rent.id, cash: cash.id }
    const types = await ok<{ id: number; kind: string }[]>('master:voucherTypes:list')
    const post = (kind: string, date: string, dr: number, cr: number, amount: number): Promise<unknown> =>
      ok('voucher:save', {
        data: {
          voucherTypeId: types.find((t) => t.kind === kind)!.id, date, partyLedgerId: null, narration: null, reference: null, instrumentNo: null,
          instrumentDate: null, transporterId: null, vehicleNo: null, transportDistanceKm: null, currencyCode: null, exchangeRate: null,
          lines: [{ ledgerId: dr, drCr: 'dr', amount, costAllocations: [] }, { ledgerId: cr, drCr: 'cr', amount, costAllocations: [] }],
          inventory: [], billRefs: [], tds: null
        }
      })
    await post('receipt', '2025-05-10', cash.id, sales.id, 50_000_00)
    await post('payment', '2025-05-11', rent.id, cash.id, 20_000_00)
    // The manufacture: 2 rods at ₹250 (opening 10 rods worth ₹2,500) + ₹100 labour = ₹600 cost;
    // the price typed is ₹1,000 → ₹400 margin.
    const units = await ok<{ id: number }[]>('master:units:list')
    const steel = (await ok<{ id: number }>('master:stockItems:create', { name: 'Steel Rod', unitId: units[0]!.id, openingQtyMilli: 10_000, openingValue: 2_500_00 })).id
    chair = (await ok<{ id: number }>('master:stockItems:create', { name: 'Chair', unitId: units[0]!.id })).id
    await ok('manufacture:save', {
      data: {
        date: '2025-06-01', finishedItemId: chair, qtyMilli: 1000, saleRatePaise: 1_000_00,
        raw: [{ stockItemId: steel, qtyMilli: 2000 }], labourPaise: 100_00, labourPosted: true, profitPaise: 400_00
      }
    })
  })

  it('the manufacture margin, the manufacture register and the cost-centre P&L are refused; owners get them', async () => {
    await asAcct()
    for (const [ch, p] of [['manufacture:margin', FY], ['manufacture:register', FY], ['cc:report', FY]] as const) {
      expect((await call(ch, p)).code, ch).toBe('not_permitted')
    }
    await asOwner()
    const reg = await ok<{ profitPaise: number; saleAmount: number; productionCost: number }[]>('manufacture:register', FY)
    expect(reg.map((r) => [r.saleAmount, r.productionCost, r.profitPaise])).toEqual([[1_000_00, 600_00, 400_00]])
    expect((await call('manufacture:margin', FY)).ok).toBe(true)
    expect((await call('cc:report', FY)).ok).toBe(true)
  })

  it('production register and cost sheet: cost and quantity stay, the sale value and margin go', async () => {
    await asOwner()
    const full = await ok<{ saleAmount: number; marginPaise: number; productionCost: number }[]>('manufacture:production', FY)
    expect(full.map((r) => [r.productionCost, r.saleAmount, r.marginPaise])).toEqual([[600_00, 1_000_00, 400_00]])
    const fullSheet = await ok<{ average: { saleAmount: number; productionCost: number } }>('manufacture:costSheet', { ...FY, itemId: chair })
    expect([fullSheet.average.productionCost, fullSheet.average.saleAmount]).toEqual([600_00, 1_000_00])

    await asAcct()
    const rows = await ok<{ saleAmount: number; marginPaise: number; marginPct: number | null; productionCost: number; qtyMilli: number }[]>('manufacture:production', FY)
    expect(rows.map((r) => [r.productionCost, r.qtyMilli, r.saleAmount, r.marginPaise, r.marginPct])).toEqual([[600_00, 1000, 0, 0, null]])
    const sheet = await ok<{ average: { saleAmount: number; productionCost: number }; manufactures: { saleAmount: number }[] }>('manufacture:costSheet', { ...FY, itemId: chair })
    expect([sheet.average.productionCost, sheet.average.saleAmount, ...sheet.manufactures.map((m) => m.saleAmount)]).toEqual([600_00, 0, 0])
  })

  type Node = { name: string; nature: string; balance: number; balanceHidden?: true; children: Node[]; ledgers: { name: string; balance: number; balanceHidden?: true }[] }
  const find = (nodes: Node[], name: string): Node | undefined => {
    for (const n of nodes) {
      if (n.name === name) return n
      const c = find(n.children, name)
      if (c) return c
    }
    return undefined
  }
  const leaf = (nodes: Node[], name: string): Node['ledgers'][number] | undefined => {
    for (const n of nodes) {
      const l = n.ledgers.find((x) => x.name === name) ?? leaf(n.children, name)
      if (l) return l
    }
    return undefined
  }

  it('chart of accounts: the income / expense totals and ledger balances are withheld; the rest stays', async () => {
    await asOwner()
    const full = await ok<Node[]>('master:chartOfAccounts', { asOn: '2026-03-31' })
    expect(find(full, 'Sales Accounts')!.balance).toBe(-50_000_00)
    expect(leaf(full, 'Rent')!.balance).toBe(20_000_00)

    await asAcct()
    const chart = await ok<Node[]>('master:chartOfAccounts', { asOn: '2026-03-31' })
    for (const g of ['Sales Accounts', 'Indirect Expenses', 'Direct Incomes', 'Purchase Accounts']) {
      expect(find(chart, g), g).toMatchObject({ balance: 0, balanceHidden: true })
    }
    expect(leaf(chart, 'Counter Sales')).toMatchObject({ balance: 0, balanceHidden: true })
    expect(leaf(chart, 'Rent')).toMatchObject({ balance: 0, balanceHidden: true })
    // Cash: 50,000 in − 20,000 out = ₹30,000 Dr, still shown (an asset).
    expect(leaf(chart, 'Cash')).toEqual(expect.objectContaining({ balance: 30_000_00 }))
    expect(leaf(chart, 'Cash')!.balanceHidden).toBeUndefined()
    // Every ledger is still listed (it is a list of masters).
    expect(leaf(chart, 'Counter Sales')).toBeDefined()
  })

  it('ledger balances: the income / expense ledgers are left out', async () => {
    await asAcct()
    const rows = await ok<{ ledgerId: number; balance: number }[]>('master:ledgerBalances', { asOn: '2026-03-31' })
    expect(rows.some((r) => r.ledgerId === led.sales || r.ledgerId === led.rent)).toBe(false)
    expect(rows.find((r) => r.ledgerId === led.cash)?.balance).toBe(30_000_00)
    await asOwner()
    const full = await ok<{ ledgerId: number; balance: number }[]>('master:ledgerBalances', { asOn: '2026-03-31' })
    expect(full.find((r) => r.ledgerId === led.sales)?.balance).toBe(-50_000_00)
  })

  it('Ask Total (review of #273): an account\'s own P&L line is withheld; the owner gets it', async () => {
    type Ans = { sentences: string[]; figures: { paise: number }[] }
    const q = { text: 'how much did i spend on rent in may 2025', today: '2026-03-31', lang: 'en' }
    await asAcct()
    const hidden = await ok<Ans>('assist:ask', q)
    expect(hidden.figures).toEqual([])
    expect(hidden.sentences.join(' ')).toContain('Profit is not shown to your sign-in')
    expect((await ok<Ans>('assist:ask', { ...q, text: 'sales of counter sales in may 2025' })).figures).toEqual([])
    await asOwner()
    const shown = await ok<Ans>('assist:ask', q)
    expect(shown.figures.map((f) => f.paise)).toEqual([20_000_00])
  })

  it('dashboard: the stock turnover goes with the margins (cost of goods ÷ stock)', async () => {
    await asAcct()
    const d = await ok<{ ratios: Record<string, number | null> }>('report:dashboard', { today: '2025-09-01', fyFrom: FY.from })
    expect(d.ratios).toMatchObject({ grossMarginPct: null, netMarginPct: null, inventoryTurnover: null })
  })

  it('the edit log: the year-end close, the manufacture and the closing journal leave their figures out', async () => {
    await asOwner()
    const closed = await ok<{ voucherId: number; netProfit: number }>('yearend:close', { fyStartYear: 2025 })
    // The closing journal moves the P&L LEDGERS: ₹50,000 sales − ₹20,000 rent − ₹100 labour the
    // manufacture posted (labourPosted) = ₹29,900 (stock is not a ledger).
    expect(closed.netProfit).toBe(29_900_00)
    type Row = { entity: string; entityId: number; beforeJson: string | null; afterJson: string | null }
    const owner = await ok<{ rows: Row[] }>('audit:list', { pageSize: 500 })
    const yearEndOwner = owner.rows.find((r) => r.entity === 'year_end')!
    expect(JSON.parse(yearEndOwner.afterJson!).netProfit).toBe(29_900_00)

    await asAcct()
    const log = await ok<{ rows: Row[] }>('audit:list', { pageSize: 500 })
    const yearEnd = log.rows.find((r) => r.entity === 'year_end')!
    expect(JSON.parse(yearEnd.afterJson!)).toEqual({ voucherId: closed.voucherId, lockedUpTo: '2026-03-31', profitHidden: true })
    const made = log.rows.filter((r) => r.entity === 'manufacture')
    expect(made.length).toBeGreaterThan(0)
    for (const r of made) {
      const after = JSON.parse(r.afterJson!) as Record<string, unknown>
      expect(after.profitPaise).toBeUndefined()
      expect(after.saleAmount).toBeUndefined()
      expect(after.profitHidden).toBe(true)
    }
    const journal = log.rows.filter((r) => r.entity === 'voucher' && r.entityId === closed.voucherId)
    expect(journal.length).toBeGreaterThan(0)
    for (const r of journal) expect(r.afterJson === null || r.afterJson === '{"profitHidden":true}').toBe(true)
    // An ordinary entry's row is unchanged (the raw books stay readable).
    const owned = owner.rows.filter((r) => r.entity === 'voucher' && r.entityId !== closed.voucherId)
    const same = log.rows.filter((r) => r.entity === 'voucher' && r.entityId !== closed.voucherId)
    expect(same).toEqual(owned)

    // Purged, the closing journal is gone from vouchers — its rows (the create row was written
    // before the flag was set) stay hidden all the same.
    await asOwner()
    await ok('company:lock:set', { date: null })
    await ok('voucher:delete', { id: closed.voucherId })
    await ok('voucher:purge', { id: closed.voucherId })
    await asAcct()
    const after = (await ok<{ rows: Row[] }>('audit:list', { pageSize: 500 })).rows.filter((r) => r.entity === 'voucher' && r.entityId === closed.voucherId)
    expect(after.length).toBeGreaterThanOrEqual(3) // create, delete (to the bin), purge
    for (const r of after) {
      expect(r.beforeJson === null || r.beforeJson === '{"profitHidden":true}').toBe(true)
      expect(r.afterJson === null || r.afterJson === '{"profitHidden":true}').toBe(true)
    }

    // The edit-log CSV leaves the same figures out.
    const csv = await ok<{ path: string }>('audit:exportCsv', {})
    const text = readFileSync(csv.path, 'utf8')
    expect(text).not.toContain('2990000')
    expect(text).toContain('profitHidden')
  })

  it('the agent mirror auto-refresh follows the saving user’s flag (one restricted save redacts it)', async () => {
    await asOwner()
    const c = ipc.getCurrentCompany()!
    vi.useFakeTimers()
    try {
      agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: true, delayMs: 1000 })
      agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: false, delayMs: 1000 })
      vi.runAllTimers()
      const tb = JSON.parse(readFileSync(join(agentBridge.agentDir(c.slug), 'trial-balance.json'), 'utf8')) as { rows: { ledgerName: string }[]; profitHidden?: boolean }
      expect(tb.profitHidden).toBe(true)
      expect(tb.rows.some((r) => r.ledgerName === 'Counter Sales' || r.ledgerName === 'Rent')).toBe(false)
      // The next window starts afresh: an owner's save writes the whole trial balance again.
      agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: true, delayMs: 1000 })
      vi.runAllTimers()
      const full = JSON.parse(readFileSync(join(agentBridge.agentDir(c.slug), 'trial-balance.json'), 'utf8')) as { profitHidden?: boolean }
      expect(full.profitHidden).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
    await ok('company:close')
  })
})

describe('a business folder on this computer’s list only (SEC-3)', () => {
  it('refuses a path, an unknown slug, and a folder that is not on the list', async () => {
    for (const slug of ['../../../../tmp/elsewhere', 'a/b', '..', 'UPPER', '']) {
      expect((await call('company:open', { slug })).ok, slug).toBe(false)
      expect((await call('company:forgetRemembered', { slug })).ok, slug).toBe(false)
    }
    // A company.db dropped into companies/ by hand is not a business on the list.
    const ghost = join(DATA_DIR, 'companies', 'ghost-books')
    mkdirSync(ghost, { recursive: true })
    writeFileSync(join(ghost, 'company.db'), '')
    const r = await call('company:open', { slug: 'ghost-books' })
    expect(r).toMatchObject({ ok: false, error: 'Company not found' })
    expect((await call('company:forgetRemembered', { slug: 'ghost-books' })).error).toBe('Company not found')
    expect(existsSync(join(ghost, 'backups'))).toBe(false)
  })
})

describe('deleting a business at its privacy screen (SEC-8)', () => {
  const PASS = 'monsoon ledger 77'
  it('is refused while locked, and always needs the passphrase although its key is in memory', async () => {
    const name = 'A3 Solo Lock Co'
    const { slug } = await ok<{ slug: string }>('company:create', company(name))
    await ok('company:open', { slug })
    await ok('security:passphrase:on', { passphrase: PASS, confirm: PASS })
    // ⌘L in a business without people: the privacy screen.
    await ok('session:lock')
    expect((await call('company:delete', { slug, confirmName: name, passphrase: PASS })).code).toBe('session_locked')
    expect(existsSync(join(DATA_DIR, 'companies', slug, 'company.db'))).toBe(true)
    await ok('session:unlock', { passphrase: PASS })
    // Unlocked and open (its key in memory): the passphrase is still asked, and checked.
    expect((await call('company:delete', { slug, confirmName: name })).code).toBe('passphrase_required')
    expect((await call('company:delete', { slug, confirmName: name, passphrase: 'wrong one here' })).code).toBe('wrong_passphrase')
    expect(existsSync(join(DATA_DIR, 'companies', slug, 'company.db'))).toBe(true)
    // The refused deletes left the open books working.
    expect((await call('master:ledgers:list')).ok).toBe(true)
    await ok('company:delete', { slug, confirmName: name, passphrase: PASS })
    expect(existsSync(join(DATA_DIR, 'companies', slug))).toBe(false)
  })

  it('a passphrase-locked business gets no plaintext agent mirror (SEC-12)', async () => {
    const { slug } = await ok<{ slug: string }>('company:create', company('A3 Mirror Lock Co'))
    await ok('company:open', { slug })
    // A mirror written while the books were plain …
    await ok('agent:exportMirror', { what: 'reports', format: 'json' })
    expect(existsSync(join(agentBridge.agentDir(slug), 'trial-balance.json'))).toBe(true)
    expect(await ok('agent:getConfig')).toMatchObject({ locked: false })
    await ok('security:passphrase:on', { passphrase: PASS, confirm: PASS })
    // … is gone once the lock is on (the lock's reopen removes it), and Settings is told why.
    expect(existsSync(agentBridge.agentDir(slug))).toBe(false)
    expect(await ok('agent:getConfig')).toMatchObject({ locked: true })
    const r = await call('agent:exportMirror', { what: 'all', format: 'all' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe(agentBridge.MIRROR_LOCKED_MESSAGE)
    const c = ipc.getCurrentCompany()!
    agentBridge.scheduleMirrorRefresh(c.db, c.slug, { canSeeProfit: true, delayMs: 0 })
    expect(existsSync(agentBridge.agentDir(slug))).toBe(false)
    await ok('company:close')
  })
})

describe('the PIN lockout grows (SEC-13)', () => {
  it('30 s at the 5th wrong PIN, then 1 min, 5 min, and 15 min from the 8th on (owner: 15-minute cap)', () => {
    expect([1, 4, 5, 6, 7, 8, 9, 20].map((n) => users.lockoutMsFor(n))).toEqual([0, 0, 30_000, 60_000, 300_000, 900_000, 900_000, 900_000])
    // The message names the time LEFT, rounded up to whole minutes past the first 30 s.
    expect([30_000, 30_001, 60_000, 61_000, 14 * 60_000 + 1].map((ms) => [users.authThrottleMessage(ms), users.authThrottleMinutes(ms)])).toEqual([
      ['Too many attempts — wait 30 seconds', 1],
      ['Too many attempts — wait 1 minute', 1],
      ['Too many attempts — wait 1 minute', 1],
      ['Too many attempts — wait 2 minutes', 2],
      ['Too many attempts — wait 15 minutes', 15]
    ])
  })

  it('login refuses for the longer wait, and the right PIN after it clears the count', async () => {
    const { slug } = await ok<{ slug: string }>('company:create', company('A3 Pin Co'))
    await ok('company:open', { slug })
    const owner = await ok<{ id: number }>('users:save', { data: { name: 'Owner', role: 'owner', pin: '5555' } })
    const db = ipc.getCurrentCompany()!.db
    const t0 = Date.now() - 10 * 60_000
    // Six wrong PINs, ten minutes ago: the 6th set a 1-minute wait, long over.
    for (let i = 0; i < 6; i++) users.recordAuthFailure(db, owner.id, t0)
    expect(users.isAuthThrottled(db, owner.id, t0 + 59_000)).toBe(true)
    expect(users.isAuthThrottled(db, owner.id, t0 + 61_000)).toBe(false)
    // The 7th wrong PIN now: 5 minutes.
    expect((await call('auth:login', { userId: owner.id, pin: '0000' })).ok).toBe(false)
    const refused = await call('auth:login', { userId: owner.id, pin: '5555' })
    expect(refused).toMatchObject({ ok: false, code: 'auth_throttled', error: 'Too many attempts — wait 5 minutes', params: { minutes: 5 } })
    expect(users.isAuthThrottled(db, owner.id, Date.now() + 4 * 60_000)).toBe(true)
    expect(users.isAuthThrottled(db, owner.id, Date.now() + 6 * 60_000)).toBe(false)
    users.clearAuthFailures(db, owner.id)
    await ok('auth:login', { userId: owner.id, pin: '5555' })
    await ok('company:close')
  })
})
