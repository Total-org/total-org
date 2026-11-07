// Site screenshots (landing page, irminflow.com): launches the BUILT app (out/) on a fresh
// scratch data dir (never ~/Documents/total), creates the Demo Traders sample company in SIMPLE
// mode ("Try with sample data", WP 8.3) and captures real screens into site/public/shots/:
//
//   home-light.png / home-dark.png   simple Home
//   home-hindi.png                   simple Home in Hindi
//   bill-light.png                   Make a bill, filled in (not saved)
//   taxes-light.png                  Taxes (GST)
//   accountant-light.png             the full app's Gateway (accountant view)
//   gstr1-light.png                  GSTR-1 in the full app
//
// Run `npm run build` first, then `node scripts/shots-site.mjs`. The site converts nothing at
// build time: next/image serves resized AVIF / WebP from these PNGs.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { Harness, PICKER_OPTION } from './lib/harness.mjs'

// The debug shot on failure goes to the harness's out dir (os.tmpdir()/total-e2e-out), never the repo.

const outDir = path.join(process.cwd(), 'site', 'public', 'shots')
fs.mkdirSync(outDir, { recursive: true })

const h = new Harness({ mode: 'simple' })
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function settle() {
  await h.waitIdle(30000)
  // Let the page's own fades finish so a shot never catches a half-drawn tile.
  await h.page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))))
  // Toasts ("Total now shows the full app.") fade on their own timer; a shot waits them out.
  await h.page.waitForFunction(() => !document.querySelector('[data-toasts]')?.children.length, null, { timeout: 15000 }).catch(() => {})
  await wait(400)
}

async function shot(name) {
  await settle()
  await h.page.screenshot({ path: path.join(outDir, `${name}.png`) })
  console.log('shot', name)
}

async function theme(want) {
  const now = await h.page.evaluate(() => document.documentElement.dataset.theme)
  if (now !== want) {
    await h.click('btn-theme')
    await h.page.waitForFunction((t) => document.documentElement.dataset.theme === t, want)
  }
}

async function pick(testId, text) {
  const input = h.page.locator(`[data-testid="${testId}"]`).first()
  await input.click()
  await input.fill(text)
  const opt = h.page.locator(PICKER_OPTION, { hasText: text }).first()
  await opt.waitFor({ timeout: 8000 })
  await opt.click()
}

async function fill(testId, text) {
  const input = h.page.locator(`[data-testid="${testId}"]`).first()
  await input.click()
  await input.fill(text)
  await input.blur()
}

async function openEntry(section, entry, screen) {
  await h.click(`simple-nav-${section}`)
  await h.page.waitForSelector(`[data-testid="simple-entry-${entry}"]`, { state: 'attached', timeout: 10000 })
  await h.click(`simple-entry-${entry}`)
  await h.waitScreen(screen, 20000)
}

try {
  await h.launch()
  await h.createDemoCompany(90000, { mode: 'simple' })
  await theme('light')

  // 1. simple Home (light, dark) — "I started fresh" puts away the day-one card first
  await h.click('simple-nav-home')
  await h.waitScreen('gateway')
  if (await h.page.$('[data-testid="simple-home-openings-fresh"]')) {
    await h.click('simple-home-openings-fresh')
    await h.page.waitForSelector('[data-testid="simple-home-openings"][data-done="false"]', { state: 'detached', timeout: 10000 }).catch(() => {})
  }
  await shot('home-light')
  await theme('dark')
  await shot('home-dark')
  await theme('light')

  // Home in Hindi (Settings → How Total looks), then back to English
  const language = async (lang) => {
    await h.click('simple-nav-settings')
    await h.page.waitForSelector('[data-testid="simple-entry-looks"]', { state: 'attached', timeout: 10000 })
    await h.click('simple-entry-looks')
    await h.page.waitForSelector('[data-testid="simple-looks"]', { state: 'attached', timeout: 10000 })
    await h.click(`btn-language-${lang}`)
    await h.page.waitForSelector('[data-testid="language-loading"]', { state: 'detached', timeout: 15000 }).catch(() => {})
    await h.click('simple-nav-home')
    await h.waitScreen('gateway')
  }
  await language('hi')
  await shot('home-hindi')
  await language('en')

  // 2. Taxes
  await openEntry('taxes', 'gst-summary', 'simple-taxes')
  await h.page.waitForSelector('[data-testid="taxes-figures"]', { state: 'attached', timeout: 20000 })
  await shot('taxes-light')

  // 3. The accountant view: the full app's Gateway and GSTR-1
  await h.setMode('accountant')
  await shot('accountant-light')
  await h.goto('gstr1', 20000)
  // The month before: the demo's busiest GST month (the running one holds a single bill).
  const select = h.page.locator('[data-screen="gstr1"] select').first()
  const prev = await select.evaluate((s) => [...s.options].find((o) => o.index === s.selectedIndex - 1)?.value ?? s.value)
  await select.selectOption(prev)
  await shot('gstr1-light')
  await h.setMode('simple')

  // 4. Make a bill, filled in for a walk-in customer (left unsaved; the last shot)
  await openEntry('sell', 'make-bill', 'simple-sell')
  const items = await h.invoke('master:stockItems:list').catch(() => [])
  const names = (Array.isArray(items) ? items : []).map((i) => i.name)
  await pick('picker-sell-item-0', (names[0] ?? 'A4').slice(0, 6))
  await fill('input-sell-qty-0', '10')
  if (names[1]) {
    await h.click('btn-sell-add-line')
    await pick('picker-sell-item-1', names[1].slice(0, 6))
    await fill('input-sell-qty-1', '1')
  }
  await h.click('sell-paid-upi')
  await h.page.waitForFunction(() => (document.querySelector('[data-testid="sell-preview"]')?.textContent ?? '').includes('UPI'), null, { timeout: 15000 })
  await shot('bill-light')
} catch (err) {
  console.error('shots-site failed:', err instanceof Error ? err.stack || err.message : String(err))
  try {
    await h.page?.screenshot({ path: path.join(h.outDir, 'shots-site-debug.png') })
  } catch {
    /* ignore */
  }
  process.exitCode = 1
} finally {
  await h.close()
  fs.rmSync(h.dataDir, { recursive: true, force: true })
}
