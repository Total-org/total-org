// Scenario 77 — Phase 3b part 2: tasks → plans, with NO AI key (Ask Total). A simple-mode shop
// with two customers on credit (one 44 days late, one 9 days late) asks "remind everyone 30 days
// late" → the answer says who and how much (the People page's figures) → "Prepare them" → Money →
// Things to approve shows ONE group headed by the task with Ramesh's reminder in plain words →
// "Copy the message" copies the People page's reminder text and logs it (reminder_log, as on the
// person's page) — nothing is sent by the app, nothing is posted. Both themes are shot; set
// PLAN_SHOTS=<dir> to copy the shots there.
import fs from 'node:fs'
import path from 'node:path'
import { scenario, assert, assertEq, localToday, relativeDate } from '../lib/harness.mjs'

await scenario('77-ai-plans', async (h) => {
  await h.createCompanyUI('Plans Shop', { mode: 'simple', coverDaysBack: 45 })
  const page = h.page
  const shot = async (name) => {
    await page.mouse.move(0, 0)
    await h.shot(name)
    if (process.env.PLAN_SHOTS) {
      fs.mkdirSync(process.env.PLAN_SHOTS, { recursive: true })
      fs.copyFileSync(path.join(h.outDir, `${name}.png`), path.join(process.env.PLAN_SHOTS, `${name}.png`))
    }
  }
  const setTheme = async (theme) => {
    const now = await page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
    if (now !== theme) await page.evaluate(() => document.querySelector('[data-testid="btn-theme"]').click())
    await page.waitForFunction((t) => (document.documentElement.dataset.theme ?? 'light') === t, theme)
  }
  const bothThemes = async (name) => {
    await setTheme('light')
    await shot(`${name}-light`)
    await setTheme('dark')
    await shot(`${name}-dark`)
    await setTheme('light')
  }
  const today = localToday()
  const groups = await h.invoke('master:groups:list')
  const gid = (name) => groups.find((g) => g.name === name).id
  const ledger = (name, group, extra = {}) =>
    h.invoke('master:ledgers:create', { name, groupId: gid(group), openingBalance: 0, gstin: null, stateCode: null, address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null, ...extra })
  if (!(await h.invoke('master:ledgers:list')).some((l) => l.name === 'Sales')) await ledger('Sales', 'Sales Accounts')
  const ramesh = await ledger('Ramesh Traders', 'Sundry Debtors', { creditDays: 1, phone: '9876543210' })
  const sita = await ledger('Sita Stores', 'Sundry Debtors', { creditDays: 1 })
  const sale = (clientId, customerId, date, amount) =>
    h.invoke('simple:post', { intent: { kind: 'sale', clientId, date, customerId, amount: { amount }, payment: { how: 'credit' } }, today })
  await sale('e2e77-sale-0001', ramesh.id, relativeDate(-45, today), 1200000)
  await sale('e2e77-sale-0002', sita.id, relativeDate(-10, today), 300000)
  const vouchers = (await h.invoke('voucher:list', { from: '2000-04-01', to: '2099-03-31' })).length

  // ---------- Ask Total: the task in words, then "Prepare them" ----------
  await h.click('btn-assistant')
  await page.waitForSelector('[data-testid="ask-panel"]', { timeout: 10000 })
  await page.fill('[data-testid="ask-input"]', 'remind everyone 30 days late')
  await h.click('ask-send')
  const answer = await page.waitForSelector('[data-testid="ask-answer"][data-intent="task"]', { timeout: 15000 })
  const said = (await answer.innerText()).replace(/\s+/g, ' ')
  assert(said.includes('1 customer is 30+ days late') && said.includes('₹12,000.00'), `the task in words (${said})`)
  await h.click('ask-prepare-plan')
  await page.waitForSelector('[data-testid="simple-approvals"]', { timeout: 10000 })

  // ---------- Things to approve: one group, the reminder in plain words ----------
  const q = await h.invoke('ai:queue')
  assertEq(q.plans.length, 1, 'one plan')
  const plan = q.plans[0]
  const card = await page.waitForSelector(`[data-testid="queue-group-${plan.key}"] [data-testid^="queue-card-reminder:"]`, { timeout: 10000 })
  const text = (await card.innerText()).replace(/\s+/g, ' ')
  assert(text.includes('Remind Ramesh Traders about ₹12,000.00 that is late'), `plain words (${text})`)
  const head = (await page.locator(`[data-testid="queue-group-${plan.key}"]`).innerText()).replace(/\s+/g, ' ')
  assert(head.includes('Reminders to customers 30+ days late (1)') && head.includes('remind everyone 30 days late'), `the group is the task (${head})`)
  await bothThemes('01-plan-simple')

  // ---------- Copy the message → logged as on the person's page; nothing posted ----------
  const item = q.proposals.find((p) => p.type === 'reminder')
  await h.click(`queue-copy-${item.key}`)
  await page.waitForSelector('[data-testid="simple-approvals-empty"]', { timeout: 10000 })
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  assert(copied.includes('Ramesh Traders') && copied.includes('12,000.00'), `the People page's reminder text was copied (${copied.slice(0, 80)})`)
  const log = await h.invoke('receivables:reminderLog', { from: '2000-01-01', to: '2099-12-31', ledgerId: ramesh.id })
  assertEq(log.length, 1, 'the reminder is logged once')
  assertEq((await h.invoke('voucher:list', { from: '2000-04-01', to: '2099-03-31' })).length, vouchers, 'nothing was posted')
})
