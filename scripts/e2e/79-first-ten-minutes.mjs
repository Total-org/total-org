// Scenario 79 — audit A7 "First ten minutes" (2026-11 audit UX-1, UX-2, UX-9, UX-15, UX-21).
//   1. First run: the wizard and "Try with sample data"; the accountant ways in (full form, sample
//      in the full app, open a backup) wait behind one line until asked for (UX-21).
//   2. "Try with sample data" opens a coherent sample shop (UX-2): its day-one figures entered (no
//      "Enter what you had on day one" card), a selling price on every product, no product below
//      zero, a real cost of goods and a profit for the year.
//   3. Settings → Business details is a plain simple screen (UX-1): the sample's address is there,
//      a changed phone number is saved to the business (company:current), no full-app hand-off.
//   4. A new shop "starting fresh" (start date left alone → today; then the FY start picked, the
//      audit's case): the empty Home's main action is "Make your first bill", its second the
//      business details (UX-15). After the first ₹500 + 18 % bill, Home's GST tile is the running
//      month so far — ₹90, due the 20th of next month — and nothing nags about last month (UX-9).
import { scenario, assert, assertEq, localToday } from '../lib/harness.mjs'

const attached = (h, sel, timeout = 15000) => h.page.waitForSelector(sel, { state: 'attached', timeout })
const visible = (h, sel) => h.page.isVisible(sel)

const nextMonth20 = (iso) => {
  const [y, m] = iso.split('-').map(Number)
  const ny = m === 12 ? y + 1 : y
  const nm = m === 12 ? 1 : m + 1
  return `${ny}-${String(nm).padStart(2, '0')}-20`
}

await scenario('79-first-ten-minutes', async (h) => {
  const { page } = h
  const today = localToday()

  // ---------- 1. first run ----------
  await h.waitScreen('company-select')
  await attached(h, '[data-testid="setup-wizard"]')
  assertEq(await page.getAttribute('[data-testid="btn-setup-accountant-ways"]', 'aria-expanded'), 'false', 'the accountant ways in start folded')
  assert(!(await visible(h, '[data-testid="btn-company-create"]')), 'the full form is not one of four exits on a shop owner’s first screen')
  assert(await visible(h, '[data-testid="btn-company-demo"]'), 'Try with sample data is offered')
  await h.shot('01-first-run')
  await h.click('btn-setup-accountant-ways')
  assert(await visible(h, '[data-testid="btn-company-create"]'), 'asked for: the full form …')
  assert(await visible(h, '[data-testid="btn-company-demo-full"]'), '… the sample in the full app …')
  assert(await visible(h, '[data-testid="btn-company-import-backup"]'), '… and open a backup')
  await h.shot('02-first-run-accountant-ways')
  await h.click('btn-setup-accountant-ways')

  // ---------- 2. the sample shop ----------
  await h.click('btn-company-demo')
  await h.waitScreen('gateway', 60000)
  await attached(h, '[data-testid="simple-home"]')
  await attached(h, '[data-testid="simple-tile-receivables"]')
  await h.waitIdle()
  if (await page.$('[data-testid="tour"]')) await h.click('tour-skip')
  assertEq(await page.$('[data-testid="simple-home-openings"][data-done="false"]'), null, 'no "Enter what you had on day one" nag in the sample')
  const openings = await h.invoke('simple:openings:get')
  assert(openings.appliedAt != null && openings.progress.done === openings.progress.total, 'the sample’s day-one figures are entered')
  const home = await h.invoke('simple:home', { today })
  assert(home.profit.year.lines.sales > 0 && home.profit.year.lines.costOfGoods > 0, `goods sold cost something (${home.profit.year.lines.costOfGoods})`)
  assert(home.profit.year.netProfit > 0, 'the sample shop made a profit this year')
  assert(home.receivables.total > 0 && home.payables.total > 0, 'customers owe it and it owes suppliers')
  await h.shot('03-sample-home')
  const stock = await h.invoke('simple:stock:list', { today })
  assert(stock.rows.length === 6, 'six products')
  for (const r of stock.rows) {
    assert(r.qtyMilli >= 0, `${r.name} is never below zero (${r.qtyMilli})`)
    assert(r.sellingPrice > 0, `${r.name} has a selling price`)
  }
  await h.click('simple-nav-stock')
  await h.click('simple-entry-products')
  await attached(h, '[data-testid="simple-stock"] [data-row-id]')
  assertEq(await page.$('[data-oversold="true"]'), null, 'no "sold more than recorded" chip in the sample')
  await h.shot('04-sample-stock')

  // ---------- 3. Business details, in plain words ----------
  await h.click('simple-nav-settings')
  await h.click('simple-entry-business')
  await attached(h, '[data-testid="simple-business"][data-loading="false"]')
  await attached(h, '[data-testid="simple-nav"]')
  assertEq(await page.$('[data-testid="btn-back-to-simple"]'), null, 'Business details stays in the simple shell')
  assert((await page.inputValue('[data-testid="input-business-address"]')).includes('MG Road'), 'the sample’s address is shown')
  assert(!/GSTR-1 filing|IRN|aggregate turnover/i.test(await page.textContent('[data-testid="simple-business"]')), 'no accountant terms')
  await h.fill('input-business-phone', '9822099999')
  await h.shot('05-business-details')
  await h.click('btn-business-save')
  await page.waitForFunction(() => document.querySelector('[data-testid="btn-business-save"]')?.disabled === true, null, { timeout: 10000 })
  assertEq((await h.invoke('company:current')).info.phone, '9822099999', 'the phone number is saved to the business')

  // ---------- 4. a new shop, starting fresh ----------
  await h.click('btn-switch-company')
  await h.waitScreen('company-select')
  await h.click('btn-company-setup')
  await attached(h, '[data-testid="setup-wizard"]')
  await h.fill('setup-name', 'Ramesh Stores')
  await h.click('setup-next')
  await h.click('setup-type-retail')
  await h.click('setup-next')
  await h.click('setup-gst-regular')
  await h.fill('setup-gstin', '27AAPFU0939F1ZV')
  await h.click('setup-filing-monthly')
  await h.click('setup-next')
  await h.click('setup-stock-no')
  await h.click('setup-next')
  // Left alone, "Starting fresh" starts the books today …
  await h.click('setup-fresh-new')
  assertEq(await page.getAttribute('[data-testid="setup-start-today"]', 'aria-checked'), 'true', 'a fresh start begins today')
  await h.shot('06-wizard-fresh-today')
  // … the audit's owner picked the FY start themselves: kept.
  await h.click('setup-start-fy')
  await h.click('setup-next')
  await h.click('setup-finish')
  await h.waitScreen('gateway', 30000)
  await attached(h, '[data-testid="simple-home"]', 20000)
  if (await page.$('[data-testid="tour"]')) await h.click('tour-skip')
  await attached(h, '[data-testid="simple-home-empty"]')
  assertEq((await page.textContent('[data-testid="simple-home-empty-first-bill"]')).trim(), 'Make your first bill', 'the empty Home’s main action')
  assertEq((await page.textContent('[data-testid="simple-home-empty-next"]')).trim(), 'Add your business details', 'business details second')
  await h.shot('07-empty-home')
  await h.click('simple-home-empty-next')
  await attached(h, '[data-testid="simple-business"][data-loading="false"]')
  await h.click('simple-nav-home')
  await attached(h, '[data-testid="simple-home-empty"]')
  await h.click('simple-home-empty-first-bill')
  await h.waitScreen('simple-sell')

  // The first bill: ₹500 + 18 % GST (₹45 CGST + ₹45 SGST) to a walk-in customer, paid in cash.
  await attached(h, '[data-testid="input-sell-amount"]')
  await h.fill('input-sell-amount', '500')
  await page.press('[data-testid="input-sell-amount"]', 'Tab')
  await h.click('sell-gst-rate-18')
  await h.click('btn-sell-save')
  await attached(h, '[data-testid="save-card"]')
  await h.click('simple-nav-home')
  await attached(h, '[data-testid="simple-tile-gst"]')
  await h.waitIdle()
  const fresh = await h.invoke('simple:home', { today })
  assert(fresh.gst?.kind === 'regular', 'regular GST')
  assertEq(fresh.gst.row.period, today.slice(0, 7), 'the GST tile is this month — the first bill’s')
  assertEq(fresh.gst.row.soFar, true, 'so far')
  assertEq(fresh.gst.row.liability, 9000, '₹90 of GST collected')
  assertEq(fresh.gst.row.gstr3bDue, nextMonth20(today), 'due the 20th of next month')
  const attention = await h.invoke('simple:homeAttention', { today })
  assert(!attention.items.some((i) => i.source === 'close'), `nothing about last month (${JSON.stringify(attention.items)})`)
  await h.shot('08-home-after-first-bill')
})
