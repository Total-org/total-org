// WP 7.1 — app launch to Home on a big company, measured on the BUILT app (out/) with Playwright.
// Copies a `total-cli perf-seed` data root to a scratch dir per run (the open backup, the weekly
// integrity stamp and the migration never touch the seed), launches, waits for the company list,
// opens Perf Traders and waits for its Home to be idle — in the full app (Gateway) and, with
// --simple, in simple mode (Home = SimpleHome). Prints launch → company list, click → Home idle,
// and the total, per run — and (Phase 5) launch → Home SHOWN: the Home screen drawn and usable
// (skeletons where figures are still on their way). --trace adds main's start-up steps
// (src/main/bootTrace.ts) and the renderer's own timings.
//
// Usage: npm run build && node scripts/perf-launch.mjs --data <perf-seed dir> [--runs 3] [--simple] [--trace] [--boot [--lang hi|hinglish]] [--app <dir>]
// (run with `env -u ELECTRON_RUN_AS_NODE` from agent shells — see CLAUDE.md.)
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { Harness } from './lib/harness.mjs'

const args = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const data = flag('data')
if (!data || !existsSync(join(data, 'perf-seed.json'))) {
  console.error('usage: node scripts/perf-launch.mjs --data <dir written by total-cli perf-seed> [--runs 3] [--simple]')
  process.exit(2)
}
const runs = Number(flag('runs', 3))
const simple = args.includes('--simple')
// --trace: print every IPC handler's duration (TOTAL_IPC_TRACE, main's stdout).
const trace = args.includes('--trace')
// --boot: also time the renderer alone — five reloads at the company list per run (the main
// process is already up): reload → company list, and the page's DOMContentLoaded (the startup
// bundle parsed and run). Far less noisy than a whole launch on a loaded machine.
const boot = args.includes('--boot')
// --lang hi|hinglish (with --boot): store that language app-wide before the measured reloads, so
// they boot as a Hindi / Hinglish user does (the catalogue chunk is loaded before the first paint);
// the `total:catalogues` measure (lib/i18n.ts preloadCatalogues) is printed too.
const lang = flag('lang', null)
// --app <dir>: another built checkout (e.g. the before build of an A/B); default this one.
const appDir = resolve(flag('app', new URL('..', import.meta.url).pathname))

const rows = []
for (let r = 0; r < runs; r++) {
  const dir = mkdtempSync(join(tmpdir(), 'total-perf-launch-'))
  cpSync(data, dir, { recursive: true })
  const h = new Harness({ dataDir: dir, appDir, outDir: join(dir, 'shots') })
  try {
    if (simple) {
      // Put the copy in simple mode first (an unmeasured launch), so the measured one opens SimpleHome.
      await h.launch()
      await h.waitScreen('company-select', 60_000)
      await h.invoke('company:open', { slug: 'perf-traders' })
      await h.invoke('ui:mode:set', { mode: 'simple' })
      await h.close()
    }
    const t0 = performance.now()
    process.env.TOTAL_IPC_TRACE = trace ? '1' : ''
    await h.launch()
    const calls = []
    if (trace) h.app.process().stdout.on('data', (b) => { for (const l of String(b).split('\n')) if (l.startsWith('[ipc] ')) calls.push(`${(performance.now() - t0).toFixed(0).padStart(6)} ${l.slice(6)}`) })
    await h.waitScreen('company-select', 60_000)
    const tList = performance.now()
    if (trace) {
      // Main's start-up steps (src/main/bootTrace.ts), ms since the main process started.
      const marks = await h.app.evaluate(() => globalThis.__totalBootMarks ?? [])
      console.log(`  main start-up (ms since the process started): ${marks.map((m) => `${m.step} ${m.ms}`).join(' · ')}`)
      const r = await h.page.evaluate(() => ({
        now: Math.round(performance.now()),
        dcl: Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd),
        render: Math.round(performance.getEntriesByName('total:first-render')[0]?.startTime ?? -1),
        fcp: Math.round(performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? -1)
      }))
      console.log(`  renderer (ms since its navigation started): DOMContentLoaded ${r.dcl} · first render ${r.render} · first contentful paint ${r.fcp} · company list seen ${r.now}; company list at ${(tList - t0).toFixed(0)} ms since launch`)
    }
    let bootRow = null
    if (boot) {
      const firstDcl = await h.page.evaluate(() => Math.round(performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd))
      if (lang) {
        await h.page.evaluate((l) => localStorage.setItem('total-language', l), lang)
        await h.page.reload()
        await h.waitScreen('company-select', 60_000)
      }
      const reloads = []
      for (let k = 0; k < 5; k++) {
        const tr = performance.now()
        await h.page.reload()
        await h.waitScreen('company-select', 60_000)
        const dcl = await h.page.evaluate(() => performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd)
        const cat = await h.page.evaluate(() => performance.getEntriesByName('total:catalogues')[0]?.duration ?? 0)
        reloads.push({ ms: performance.now() - tr, dcl, cat })
      }
      const mid = (k) => reloads.map((x) => x[k]).sort((a, b) => a - b)[2]
      bootRow = { firstDcl, reload: mid('ms'), dcl: mid('dcl'), cat: mid('cat') }
      console.log(`  renderer boot${lang ? ` (${lang})` : ''}: first launch DOMContentLoaded ${firstDcl} ms; reload → company list ${mid('ms').toFixed(0)} ms, DOMContentLoaded ${mid('dcl').toFixed(0)} ms, catalogue wait ${mid('cat').toFixed(1)} ms (median of 5 reloads)`)
    }
    // Phase 5: the moments are taken IN THE PAGE by a MutationObserver (not frame-bound — Playwright's
    // waitForSelector polls on animation frames, which an unfocused window throttles, so it noticed
    // the Home screen up to a second late). Home SHOWN = the Home screen drawn and usable, figures
    // still loading in skeletons (gateway-dashboard / simple-home); Home idle = nothing loading.
    await h.page.evaluate(() => {
      const w = window
      w.__perfLaunch = { t0: performance.now(), shown: null, idle: null }
      const look = () => {
        const p = w.__perfLaunch
        if (p.shown === null && document.querySelector('[data-testid="gateway-dashboard"], [data-testid="simple-home"]')) p.shown = performance.now()
        // Idle: nothing fetching AND no card still in its skeleton (a moment before the first
        // query starts must not count).
        if (p.shown !== null && p.idle === null && document.querySelector('[data-screen="gateway"][data-loading="false"]') && !document.querySelector('[data-state="loading"], [data-testid="simple-home-skeleton"]')) p.idle = performance.now()
      }
      new MutationObserver(look).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-loading', 'data-testid', 'data-state'] })
    })
    const tOpen = performance.now() // = tList unless --boot reloaded first
    await h.clickText('Perf Traders')
    await h.page.waitForFunction(() => window.__perfLaunch.idle !== null, null, { timeout: 120_000, polling: 50 })
    if (simple) await h.page.waitForSelector('[data-testid="simple-home"]', { state: 'attached', timeout: 120_000 })
    const p = await h.page.evaluate(() => window.__perfLaunch)
    const shownMs = p.shown - p.t0
    const idleMs = p.idle - p.t0
    const tHome = tOpen + idleMs
    // The company:open round trip alone (a second open in this session: no weekly check due).
    await h.invoke('company:close')
    const t1 = performance.now()
    await h.invoke('company:open', { slug: 'perf-traders' })
    const ipc = performance.now() - t1
    const shown = tList - t0 + shownMs
    rows.push({ list: tList - t0, shown, open: tHome - tOpen, total: tList - t0 + (tHome - tOpen), ipc, ...(bootRow ?? {}) })
    if (trace) console.log(`  IPC calls (ms since launch, handler ms):\n  ${calls.join('\n  ')}`)
    console.log(`run ${r + 1}: launch → company list ${(tList - t0).toFixed(0)} ms, launch → Home shown ${shown.toFixed(0)} ms, open → Home idle ${(tHome - tOpen).toFixed(0)} ms, total ${(tList - t0 + tHome - tOpen).toFixed(0)} ms; company:open alone ${ipc.toFixed(0)} ms`)
  } finally {
    await h.close().catch(() => {})
    rmSync(dir, { recursive: true, force: true })
  }
}
const med = (k) => rows.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(rows.length / 2)]
console.log(`median (${simple ? "simple Home" : "Gateway"}): launch → list ${med("list").toFixed(0)} ms, launch → Home shown ${med("shown").toFixed(0)} ms, open → Home ${med("open").toFixed(0)} ms, total ${med("total").toFixed(0)} ms, company:open alone ${med("ipc").toFixed(0)} ms`)
if (boot) console.log(`median renderer boot: first launch DOMContentLoaded ${med('firstDcl')} ms, reload → company list ${med('reload').toFixed(0)} ms, reload DOMContentLoaded ${med('dcl').toFixed(0)} ms, catalogue wait ${med('cat').toFixed(1)} ms${lang ? ` (${lang})` : ''}`)
