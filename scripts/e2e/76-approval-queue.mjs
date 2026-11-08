// Scenario 76 — Phase 3b: ONE approval queue (TOTAL_AI_MOCK=1, offline). Accountant mode: two
// payment drafts from the AI chat → the panel's "Approve them in the approval queue" → the queue
// lists both; a row opens its accounts with Dr / Cr; Approve saves it (the voucher is in the
// books, the draft consumed) and Discard drops the other (nothing saved). Simple mode: an Ask
// Total offer (no key needed) and a chat draft wait under Money → Things to approve in plain words;
// Approve posts the offer through simple:post. Nothing is saved before a click. Both views are
// shot in both themes; set QUEUE_SHOTS=<dir> to copy the shots there.
import fs from 'node:fs'
import path from 'node:path'
import { scenario, assert, assertEq, localToday } from '../lib/harness.mjs'

process.env.TOTAL_AI_MOCK = '1'

await scenario('76-approval-queue', async (h) => {
  await h.createCompanyUI('Queue Co')
  const shot = async (name) => {
    await h.page.mouse.move(0, 0)
    await h.shot(name)
    if (process.env.QUEUE_SHOTS) {
      fs.mkdirSync(process.env.QUEUE_SHOTS, { recursive: true })
      fs.copyFileSync(path.join(h.outDir, `${name}.png`), path.join(process.env.QUEUE_SHOTS, `${name}.png`))
    }
  }
  const setTheme = async (theme) => {
    const now = await h.page.evaluate(() => document.documentElement.dataset.theme ?? 'light')
    if (now !== theme) await h.page.evaluate(() => document.querySelector('[data-testid="btn-theme"]').click())
    await h.page.waitForFunction((t) => (document.documentElement.dataset.theme ?? 'light') === t, theme)
  }
  const bothThemes = async (name) => {
    await setTheme('light')
    await shot(`${name}-light`)
    await setTheme('dark')
    await shot(`${name}-dark`)
    await setTheme('light')
  }
  const groups = await h.invoke('master:groups:list')
  const gid = (name) => groups.find((g) => g.name === name).id
  const ledger = (name, group) =>
    h.invoke('master:ledgers:create', { name, groupId: gid(group), openingBalance: 0, gstin: null, stateCode: '27', address: null, taxType: null, gstRate: null, hsn: null, tdsSectionId: null, pan: null, creditDays: null, exportType: null })
  const rent = await ledger('Shop Rent', 'Indirect Expenses')
  await ledger('Ramesh Traders', 'Sundry Debtors')
  await h.enableAi()
  await h.goto('settings') // the settings screen refreshes the cached AI settings
  const today = localToday()
  const vouchers = async () => (await h.invoke('voucher:list', { from: '2000-04-01', to: '2099-03-31' })).length

  // ---------- accountant: two chat drafts → the queue ----------
  await h.openAiChat()
  for (const q of ['Pay 2,500 shop rent in cash', 'Pay 700 shop rent in cash']) {
    const before = (await h.invoke('ai:drafts', { status: 'open' })).length
    await h.fill('ai-input', q)
    await h.page.press('[data-testid="ai-input"]', 'Enter')
    await h.page.waitForFunction((n) => document.querySelectorAll('[data-testid="ai-draft-card"][data-status="open"]').length > n, before, { timeout: 20000 })
    await h.page.waitForSelector('[data-testid="btn-ai-send"]', { timeout: 20000 })
  }
  assertEq(await vouchers(), 0, 'drafting saved nothing')
  // Phase 3b part 3: the same proposals wait on the ONE panel's "To approve" tab (with its count).
  await h.click('btn-back-ask-total')
  await h.page.waitForSelector('[data-testid="tab-ai-queue-queue"]', { timeout: 10000 })
  assert((await h.page.textContent('[data-testid="tab-ai-queue-queue"]')).includes('2'), 'the tab counts the two proposals')
  await h.click('tab-ai-queue-queue')
  await h.page.waitForSelector('[data-testid="ask-queue-panel"] [data-testid^="queue-card-draft:"]', { timeout: 10000 })
  assertEq(await h.page.locator('[data-testid="ask-queue-panel"] [data-testid^="queue-card-draft:"]').count(), 2, 'both drafts on the tab')
  await bothThemes('00-panel-to-approve')
  await h.click('ask-queue-full')
  await h.waitScreen('ai-queue')
  await h.page.waitForSelector('[data-key^="draft:"]', { timeout: 10000 })
  const queue = await h.invoke('ai:queue')
  assertEq(queue.proposals.length, 2, 'both drafts wait in the queue')
  const [big, small] = [queue.proposals.find((p) => p.amount === 250000), queue.proposals.find((p) => p.amount === 70000)]
  assert(big && small, 'the queue carries each amount in paise')
  await h.page.click(`[data-key="${big.key}"]`)
  const lines = await h.page.waitForSelector(`[data-testid="queue-lines-${big.key}"]`, { timeout: 5000 })
  const linesText = await lines.textContent()
  assert(linesText.includes('Shop Rent') && linesText.includes('Cash') && linesText.includes('2,500.00'), `accounts with Dr / Cr: ${linesText}`)
  await bothThemes('01-queue-accountant')
  await h.click(`queue-approve-${big.key}`)
  await h.page.waitForSelector(`[data-key="${big.key}"]`, { state: 'detached', timeout: 10000 })
  assertEq(await vouchers(), 1, 'Approve saved one voucher')
  const saved = await h.invoke('ai:draft:get', { id: big.id })
  assertEq(saved.status, 'consumed', 'the approved draft is consumed')
  const v = await h.invoke('voucher:get', { id: saved.voucherId })
  assert(v.lines.some((l) => l.ledgerId === rent.id && l.drCr === 'dr' && l.amount === 250000), 'Dr Shop Rent ₹2,500')
  await h.page.click(`[data-key="${small.key}"]`)
  await h.click(`queue-discard-${small.key}`)
  await h.page.waitForSelector(`[data-key="${small.key}"]`, { state: 'detached', timeout: 10000 })
  assertEq((await h.invoke('ai:draft:get', { id: small.id })).status, 'discarded', 'Discard dropped it')
  assertEq(await vouchers(), 1, 'Discard saved nothing')

  // ---------- simple: an Ask Total offer (no key) in plain words ----------
  await h.setMode('simple')
  const offer = await h.invoke('assist:draft', { text: 'Ramesh Traders se 5000 mile', today })
  assert(offer.draftId, 'Ask Total made an offer')
  await h.click('simple-nav-money')
  await h.click('simple-entry-approvals')
  const card = await h.page.waitForSelector(`[data-testid="queue-card-draft:${offer.draftId}"]`, { timeout: 10000 })
  const said = await card.textContent()
  assert(said.includes('Money in from Ramesh Traders: ₹5,000.00') && said.includes('From Ask Total'), `plain words: ${said}`)
  await bothThemes('02-queue-simple')
  await h.click(`queue-approve-draft:${offer.draftId}`)
  await h.page.waitForSelector('[data-testid="simple-approvals-empty"]', { timeout: 10000 })
  assertEq(await vouchers(), 2, 'Approve posted the offer')
  assertEq((await h.invoke('ai:draft:get', { id: offer.draftId })).status, 'consumed', 'the offer is consumed')
})
