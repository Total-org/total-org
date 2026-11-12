// Scenario 81 — A8 part 2 (audit 2026-11 UX-12): switching company without the round trip.
//   1. The accountant demo company is open; ⌘O opens the switcher: no other company yet, so it
//      says so and offers "All businesses…", which closes the books on the company list.
//   2. The company list: Demo Traders (opened last) is first, and "Set up your business" is not
//      the main button while a company exists. A second company is made with the full form.
//   3. From Second Co, ⌘O lists Demo Traders; typing "demo" + Enter opens it — the Gateway of Demo
//      Traders, through the company list's own open (no stop on the list screen in between).
//   4. Esc closes the switcher and leaves the open company as it was.
import { scenario, assert, assertEq } from '../lib/harness.mjs'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

await scenario('81-company-switcher', async (h) => {
  const { page } = h
  await h.createDemoCompany()
  const openSwitcher = async () => {
    await page.keyboard.press(`${MOD}+o`)
    await page.waitForSelector('[data-testid="input-company-switch"]', { timeout: 5000 })
  }

  // ---- 1. nothing else yet: "All businesses…" goes to the list
  await openSwitcher()
  await page.waitForSelector('[data-testid="company-switch-none"]', { timeout: 5000 })
  await h.shot('01-switcher-alone')
  await page.click('[data-testid="company-switch-all"]')
  await h.waitScreen('company-select', 15000)

  // ---- 2. the list: last opened first; the wizard is not the main button
  const cls = await page.getAttribute('[data-testid="btn-company-setup"]', 'class')
  assert(!(cls ?? '').includes('t-btn-primary'), `the setup wizard is not the primary button (class ${cls})`)
  const first = await page.$eval('[data-screen="company-select"] .kbar-row', (el) => el.textContent ?? '')
  assert(first.includes('Demo Traders'), `the company opened last is first (got ${first})`)
  await h.shot('02-company-list')
  await h.createCompanyUI('Second Co')
  const current = () => page.evaluate(() => document.querySelector('header button[aria-label$="company details"]')?.getAttribute('aria-label') ?? '')
  assert((await current()).startsWith('Second Co'), 'Second Co is open')

  // ---- 3. ⌘O → "demo" → Enter: Demo Traders opens
  await openSwitcher()
  await page.waitForSelector('[data-testid^="company-switch-demo"]', { timeout: 5000 })
  const listed = await page.$$eval('[data-testid="list-company-switch"] [role="option"]', (els) => els.map((e) => e.textContent ?? ''))
  assert(!listed.some((t) => t.includes('Second Co')), 'the open company is not offered')
  await page.fill('[data-testid="input-company-switch"]', 'demo')
  await h.shot('03-switcher-filtered')
  await page.press('[data-testid="input-company-switch"]', 'Enter')
  await h.waitScreen('gateway', 20000)
  await page.waitForFunction(() => document.querySelector('header button[aria-label$="company details"]')?.getAttribute('aria-label')?.startsWith('Demo Traders'), null, { timeout: 15000 })

  // ---- 4. Esc closes the switcher, nothing else changes
  await openSwitcher()
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="input-company-switch"]', { state: 'detached', timeout: 5000 })
  assertEq(await page.locator('[data-screen="gateway"]').count(), 1, 'still on the Gateway')
  assert((await current()).startsWith('Demo Traders'), 'still in Demo Traders')
})
