// Scenario 82 — A9 (audit 2026-11 UX-5 / UX-17 / UX2-3 / UX-22): simple polish.
//   1. The sample shop (regular GST) in simple mode: the Taxes section page leads with the GST card —
//      the cash to pay = simple:taxes' figure (= the Home tile's), both due dates — the plain GST
//      screen is not listed again, and the full-app screens sit under "For your CA". Its button opens
//      the plain GST screen.
//   2. ⌘K: a modal dialog named in plain words; the empty footer says "Try: …" — no filter syntax;
//      the palette passes the a11y sweep (no unlabeled control).
//   3. The company list names the data folder Total really uses (here the scratch TOTAL_DATA_DIR),
//      never the fixed "~/Documents/total".
// (UX-19, the test-portal card behind Options on GSTR-1 / 3B, is checked in 75.)
import path from 'node:path'
import { scenario, assert, assertEq } from '../lib/harness.mjs'
import { sweepInto } from '../lib/a11y.mjs'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

await scenario('82-simple-polish', async (h) => {
  const { page } = h
  await h.createDemoCompany(60000, { mode: 'simple' })
  await page.waitForSelector('[data-testid="simple-nav"]', { timeout: 20000 })

  // ---- 1. the Taxes hub
  await h.click('simple-nav-taxes')
  await page.waitForSelector('[data-testid="simple-taxes-hub-to-pay"]', { timeout: 15000 })
  const tx = await h.invoke('simple:taxes', {})
  assertEq(tx.kind, 'regular', 'the sample shop is a regular registration')
  const shown = (await page.textContent('[data-testid="simple-taxes-hub-to-pay"]')) ?? ''
  assertEq(shown.replace(/\D/g, ''), String(tx.figures.toPay), `the card's cash to pay is simple:taxes' figure (${shown})`)
  for (const form of ['gstr1', 'gstr3b']) {
    const line = (await page.textContent(`[data-testid="simple-taxes-hub-due-${form}"]`)) ?? ''
    assert(line.includes(form === 'gstr1' ? 'GSTR-1' : 'GSTR-3B') && /\d{4}/.test(line), `the ${form} due date is on the card (${line})`)
  }
  assertEq(await page.locator('[data-testid="simple-entry-gst-summary"]').count(), 0, 'the plain GST screen is the card, not listed again')
  const caFirst = await page.evaluate(() => {
    const ca = [...document.querySelectorAll('h2')].find((e) => e.textContent === 'For your CA')
    const entry = document.querySelector('[data-testid="simple-entry-gst-sales"]')
    return !!ca && !!entry && !!(ca.compareDocumentPosition(entry) & Node.DOCUMENT_POSITION_FOLLOWING)
  })
  assert(caFirst, 'GSTR-1 (full app) sits under "For your CA"')
  await h.shot('01-taxes-hub')
  await h.click('simple-taxes-hub-open')
  await page.waitForSelector('[data-testid="taxes-figures"]', { timeout: 15000 })

  // ---- 2. ⌘K in a simple company
  await page.keyboard.press(`${MOD}+k`)
  await page.waitForSelector('[data-testid="input-palette"]', { timeout: 5000 })
  const dialog = page.getByRole('dialog', { name: 'Search and go' })
  assertEq(await dialog.count(), 1, 'the palette is a dialog named in plain words')
  assertEq(await dialog.getAttribute('aria-modal'), 'true', 'a modal dialog')
  const help = (await page.textContent('[data-testid="palette-help"]')) ?? ''
  assert(help.startsWith('Try:') && !/amt:|gstin:|Filters/.test(help), `a plain footer (${help})`)
  const failures = []
  await sweepInto(page, 'palette', failures)
  assert(failures.length === 0, `the palette passes the a11y sweep: ${failures.join('; ')}`)
  await h.shot('02-palette')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="input-palette"]', { state: 'detached', timeout: 5000 })

  // ---- 3. the real data folder on the company list
  await h.click('btn-switch-company')
  await h.waitScreen('company-select', 15000)
  const where = (await page.textContent('[data-screen="company-select"] p')) ?? ''
  assert(where.includes(path.basename(h.dataDir)), `the company list names the folder in use (${where})`)
  assert(!where.includes('Documents'), `not the fixed default folder (${where})`)
  await h.shot('03-company-list-folder')
})
