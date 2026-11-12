// Scenario 79 — A8 (audit 2026-11, CA defaults pack) on the accountant demo company:
//   1. UX-3: a sales invoice's party list starts with customers (Sundry Debtors), a purchase's with
//      suppliers; neither offers a tax, income or expense ledger (the list used to be every ledger
//      A–Z: Bharat Steel Suppliers, Cash, CGST Input, CGST Output …).
//   2. UX-18: on the sales invoice Tab reaches Save before Cancel, and the e-way dispatch fields
//      (vehicle / transporter / distance) wait in the collapsed "GST and dispatch details".
//   3. UX-10: the trial balance is as on today (and says so); "Group-wise" groups it; the balance
//      sheet's as-on date is today; "Compare periods" sits in the P&L / BS header.
//   4. UX-4: GSTR-3B and GSTR-1 open on the period `gst:duePeriod` names (the Compliance card's).
// Defaults and order only: every figure is the service's for the date shown.
import { scenario, assert, assertEq, localToday } from '../lib/harness.mjs'

await scenario('79-ca-defaults', async (h) => {
  const { page } = h
  const today = localToday()
  await h.createDemoCompany()
  const ledgers = await h.invoke('master:ledgers:list')
  const groups = await h.invoke('master:groups:list')
  const groupOf = new Map(ledgers.map((l) => [l.id, groups.find((g) => g.id === l.groupId)?.name]))

  /** The party picker's options, in order, as group names (from the option's ledger id). */
  const partyGroups = async () => {
    const input = page.locator('[data-testid="picker-party"]').first()
    await input.click()
    await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 10000 })
    const ids = await page.$$eval('[role="listbox"] [role="option"]:not([data-create])', (els) => els.map((e) => Number(e.id.split('-').pop())))
    await input.press('Escape')
    return ids.map((id) => groupOf.get(id))
  }
  const NEVER = ['Duties & Taxes', 'Sales Accounts', 'Purchase Accounts', 'Direct Expenses', 'Indirect Expenses', 'Direct Incomes', 'Indirect Incomes']

  // ---- 1. UX-3: party list per voucher type
  await h.goto('voucher-entry')
  await h.click('tab-voucher-entry-sales')
  await page.waitForSelector('[data-testid="voucher-entry-mode"][data-mode="invoice"]', { timeout: 10000 })
  let list = await partyGroups()
  assertEq(list[0], 'Sundry Debtors', 'a sale lists customers first')
  assert(list.every((g) => !NEVER.includes(g)), `a sale's party list holds no tax / income / expense ledger (got ${list.join(', ')})`)
  const lastDebtor = list.lastIndexOf('Sundry Debtors')
  const firstCreditor = list.indexOf('Sundry Creditors')
  assert(firstCreditor === -1 || firstCreditor > lastDebtor, 'suppliers come after every customer on a sale')
  await h.shot('01-sales-party-list')

  // ---- 2. UX-18: Save before Cancel; the e-way fields are in the collapsed section
  const order = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('[data-screen="voucher-entry"] button')]
    const save = buttons.findIndex((b) => b.getAttribute('data-testid') === 'btn-save-voucher')
    const cancel = buttons.findIndex((b) => b.textContent?.trim() === 'Cancel')
    return { save, cancel }
  })
  assert(order.save >= 0 && order.cancel > order.save, `Save comes before Cancel in the tab order (${JSON.stringify(order)})`)
  assertEq(await page.locator('input[placeholder="Vehicle number"]').count(), 0, 'no e-way field on the keyboard path')
  await h.click('btn-invoice-gst-details')
  await page.waitForSelector('input[placeholder="Vehicle number"]', { timeout: 5000 })
  await h.shot('02-dispatch-details')

  await h.click('tab-voucher-entry-purchase')
  await page.waitForSelector('[data-testid="voucher-entry-mode"][data-mode="invoice"]', { timeout: 10000 })
  list = await partyGroups()
  assertEq(list[0], 'Sundry Creditors', 'a purchase lists suppliers first')
  assert(list.every((g) => !NEVER.includes(g)), `a purchase's party list holds no tax / income / expense ledger (got ${list.join(', ')})`)

  // ---- 3. UX-10: reports dated today
  await h.goto('trial-balance')
  const tb = await h.invoke('report:trialBalance', { asOn: today })
  await page.waitForSelector('[data-testid="rows-trial-balance"] tr.dt-row', { timeout: 15000 })
  const fyEnd = `${Number(today.slice(0, 4)) + (Number(today.slice(5, 7)) >= 4 ? 1 : 0)}-03-31`
  if (today !== fyEnd) {
    // Before the year's last day the note must be there (review of #249: never optional).
    await page.waitForSelector('[data-testid="trial-balance-up-to-today"]', { timeout: 5000 })
    assert(/after today/.test(await page.textContent('[data-testid="trial-balance-up-to-today"]')), 'the trial balance says it stops at today')
  } else {
    assertEq(await page.locator('[data-testid="trial-balance-up-to-today"]').count(), 0, 'on the year end itself there is nothing to say')
  }
  const rowsShown = await page.locator('[data-testid="rows-trial-balance"] tr.dt-row[data-row-id]').count()
  assert(rowsShown > 0 && tb.rows.length > 0, 'the trial balance shows rows')
  await h.click('input-trial-balance-grouped')
  await page.waitForSelector('[data-testid="rows-trial-balance"] tr.dt-group', { timeout: 10000 })
  await h.shot('03-trial-balance-group-wise')
  await h.click('input-trial-balance-grouped')
  await page.waitForFunction(() => !document.querySelector('[data-testid="rows-trial-balance"] tr.dt-group'), null, { timeout: 10000 })

  await h.goto('balance-sheet')
  await page.waitForSelector('[data-testid="input-bs-ason"]', { timeout: 15000 })
  // The DateInput shows the Tally style dd-Mon-yy (shared/dates.ts toDisplayDate): today, exactly.
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const display = `${today.slice(8, 10)}-${MON[Number(today.slice(5, 7)) - 1]}-${today.slice(2, 4)}`
  assertEq(await page.inputValue('[data-testid="input-bs-ason"]'), display, 'the balance sheet is as on today')
  assert(await page.locator('[data-testid="input-statement-compare"]').count(), 'Compare periods is in the balance sheet header')

  // ---- 4. UX-4: the GST returns open on the period being filed
  const due = await h.invoke('gst:duePeriod')
  assert(due && /^\d{4}-\d{2}$/.test(due.period), `a regular company has a due period (${JSON.stringify(due)})`)
  for (const form of ['gstr3b', 'gstr1']) {
    await h.goto(form)
    await page.waitForSelector(`[data-testid="input-${form}-month"]`, { timeout: 15000 })
    const months = await page.$$eval(`[data-testid="input-${form}-month"] option`, (os) => os.map((o) => o.value))
    if (months.includes(due.period)) assertEq(await page.inputValue(`[data-testid="input-${form}-month"]`), due.period, `${form} opens on the period due`)
  }
  await h.shot('04-gstr1-due-month')
})
