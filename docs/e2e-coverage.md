# E2E coverage matrix (WP 7.4)

Every work package of the revamp roadmap (`docs/superpowers/specs/2026-10-07-total-revamp-roadmap.md`,
Phases 1–7) and of the simple-for-everyone plan (`2026-10-13-simple-for-everyone-plan.md`, Phases 8–10)
mapped to the UI E2E scenarios in `scripts/e2e/` that exercise it in the BUILT app. "Gap filled" marks
the scenarios WP 7.4 added. Unit / DB tests are listed only where a WP has no UI to drive.

Run them: `npm run build && npm run e2e` (filter: `node scripts/run-e2e.mjs 66 67`, three runs in a
row: `node scripts/run-e2e.mjs --repeat 3`, a CI shard: `--shard 2/3`).

## Phase 1 — Foundation and UI/UX revamp

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 1.1 | Collapsible navigation, sections persisted, ←/→ on headings | 02, 11 | |
| 1.2 | Masters chart of accounts tree, ledger filter by group / GSTIN | 66 (gap filled), 01, 15 | |
| 1.3 | Year-opening: income/expense reset, ledger statement = TB across the boundary | 67 (gap filled), 08 | |
| 1.4 | One editor per voucher kind, load → save round trip | 03, 17, 68 (gap filled: physical stock) | DB: `voucherEdit.dbtest.ts` |
| 1.5 | Secrets out of the DB, NIC credentials masked | 13 | |
| 1.6 | Table platform: sort, filters, column chooser, saved views, CSV export | 66 (gap filled), 11 | |
| 1.7 | Every list on the table platform | 02 (tour), 11, 12 (sweep), 66 | |
| 1.8 | Drill-down: name = edit, row = statement, ⌘E | 15 | |
| 1.9 | Search: palette, results screen, prefixes, recents | 14 | |
| 1.10 | Design system, dashboard, options panels, print templates, a11y | 12, 16, 18 | |

## Phase 2 — Inventory, manufacturing, trade cycle

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 2.1 | Global valuation pass, conserved manufacture cost | 17, 21 | unit: `valuation.test.ts` |
| 2.2 | Manufacture voucher | 17 | |
| 2.3 | Movement register, stock journal / godown transfer, serials, reorder | 19 | |
| 2.3 | Valuation method per item (FIFO), stock ageing, negative stock, barcode labels, physical stock | 68 (gap filled) | |
| 2.4 | Multi-level BOM, versions, scrap, job work, manufacturing reports | 21 | |
| 2.5 | Quotation / SO / PO, challans / GRNs, returns, linked docs, trade reports | 24, 26, 28 | |
| 2.5b lists | Challans / GRNs lists, convert two challans of one party to one invoice | 24 | renderer: `tradeNoteList.test.tsx`; db: `tradeLists.dbtest.ts`, `tradeConvert.dbtest.ts` |
| 2.6 | Price levels, schemes, counter billing | 29 | |

## Phase 3 — Compliance

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 3.1 | TDS core: tagged payable ledgers, suggestion in the invoice form | 03, 20 | |
| 3.2 | TDS screen: eligible → move, deducted, challans, returns | 20 | |
| 3.3 | TCS | 23 | |
| 3.4 | GSTR-9, ITC-04, 2B matching / IMS, RCM self-invoices, ITC reversal | 25, 44 | |
| 3.5 | NIC: connection test against the fake sandbox; e-way JSON | 06, 13 | |
| 3.5 | E-invoice JSON export | 70 (gap filled) | live IRN: see 70's header |
| 3.5 | NIC follow-ups: signed invoice / QR stored and saved, Cancel IRN, cancel e-way bill + history, correction workflow (`irn_frozen` / `irn_live`) | 70 | against the fake sandbox; Extend validity only says when its ±8 h window opens (the fake's clock can't reach it) — the extension itself is in `nicContract.dbtest` / `einvoiceDetails.test` |
| 3.6 | ~~Fixed assets~~ — removed in A13b; old books read: `cutFeaturesRead.dbtest.ts` (guards: `fixedAssetsLegacy.dbtest.ts`) | — | |
| 3.7 | Payroll + salary TDS (Form 16); ~~PF / ESI / PT~~ — removed in A13b (scenario 27 deleted); old books read: `cutFeaturesRead.dbtest.ts` (old runs / dues: `payrollStatutory.dbtest.ts`) | 07 | |
| 3.8 | Audit trail / edit log, chain verification | 30 | |
| — | GSTR-1 / 3B | 06, 46 | |
| — | Year-end close, closing journal immutable, lock date, reopen through the bin | 08, 67 (gap filled) | |
| — | ~~Guided re-close of earlier closes~~ — removed (feature cleanup) | — | |

## Phase 4 — Banking, receivables, cash

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 4.1 | CSV import + BRS | 05 | |
| 4.1 | Column mapping, learned rules, cheque books / printing, register backfill, bulk NEFT file | 31 | |
| 4.1 | MT940 / Excel / CAMT.053 statements, re-import dedupe, post-dated cheques (mature / bounce) | 72 (gap filled) | parsers: `bankFormats.test.ts` |
| 4.2 | Statements, reminders, credit hold, follow-ups (interest notes removed, audit A13b — 32 posts a plain debit note instead and checks the Interest tab is gone) | 32 | |
| 4.3 | Payment plan, MSME s.15 / s.16, payment runs, Form 1 | 33 | |
| 4.4 | Cash-flow forecast (budgets, loan schedules and the forex screen removed in the 1.0 cleanup — 34 checks a USD entry still reads; revaluations / settlements / foreign openings of older books and Reverse…: dbtests + renderer tests) | 34 | |
| — | Cost centres, cash flow statement, exceptions (Checks → Exceptions since A13c), CA pack | 69 (gap filled) | |

## Phase 5 — AI agent

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 5.1 | Core: settings, notice, key, mock provider, tool chips, drafts | 35 | |
| 5.2 | Chat panel, Explain this | 39 | |
| 5.3 | Voucher drafting + review | 41 | |
| 5.4 | Document capture, statement categorising | 45 | |
| 5.5 | Assistants: close checklist, 2B mismatches, anomalies ("report from a question" removed with the report builder; tabs of Analysis → Checks since A13c) | 44 | |
| 5.6 | Memory | 43 | |
| 5.7 | ~~MCP server~~ — removed (feature cleanup) | — | |
| 5.8 | ~~Evaluation suite~~ — removed (feature cleanup) | — | |

## Phase 6 — Reports, analytics, data

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 6.1 | ~~Report builder, saved reports~~ — removed (feature cleanup) | — | |
| 6.2 | Ratios, comparatives (scheduled packs removed) | 37 | |
| 6.3 | Books export → import round trip, Zoho mapping | 36 | |
| 6.3 | Busy import + undo | 71 (gap filled) | |
| 6.4 | Bulk edit of vouchers, attachments in backups | 38 | |
| 6.4 | Bulk edit of masters / party notes | 71 (gap filled) | see 71's header |
| 6.5 | ~~Consolidation with eliminations~~ — removed (feature cleanup) | — | |

## Phase 7 — Platform

| WP | Feature | Scenario(s) | Notes |
| --- | --- | --- | --- |
| 7.1 | Performance budgets | — | `*.perf.dbtest.ts` |
| 7.2 | Security: passphrase lock (encryption at rest), backup restore check, capability flags, session lock (⌘L, auto-lock) | 65, 10 | `security.dbtest.ts`, `db/encryption.dbtest.ts`, `db/encryption.perf.dbtest.ts` |
| 7.3 | Windows parity | — | CI `build-win` (unit + DB + build) |
| 7.4 | This matrix, date helpers, `--repeat`, zero-flake runs | all | |
| — | Tally import, backup / restore, roles + lock | 04, 09, 10 | |

## Phases 8–10 — Simple for everyone

| WP | Feature | Scenario(s) |
| --- | --- | --- |
| 8.0 | Registration rule: unregistered / composition bills, effective-dated registration | 46, 70 (gap filled: Company details change) |
| 8.1 | Company mode, simple shell, Accountant view | 47 |
| 8.2 / 10.4 | i18n, Hindi / Hinglish | 64 |
| 8.3 | Setup wizard, presets, features | 48 |
| 8.4 | Plain pickers, quick-create | 50 |
| 8.5 | Field errors, save card, undo | 49 |
| 8.6 | Simple Home | 52 |
| 8.7 | Opening setup | 51 |
| 9.1 | Intents / `simple:post` | 53–59 (through the flows) |
| 9.2 | Make a bill | 53 |
| 9.3 | Record a purchase | 54 |
| 9.4 | Money in / out / move | 55 |
| 9.5 | Returns (+ returns in parts reopened in the full editor, PR #190) | 56, 74 |
| 9.6 | Bank, simple | 57 |
| 9.7 | Stock and Made goods (+ the recipe editor on a product: add a recipe, then make goods with it) | 58 |
| 9.8 | People | 59 |
| 9.9 | Plain reports and Taxes | 61 |
| 9.10 | Accountant-view hand-off | 62 |
| 10.1 | Ask Total | 60 |
| 10.2 | "Why?" sentences | 52, 61 |
| 10.3 | Tour, empty states, help panel | 52, 63 |
| 10.5 | Keyboard / a11y / window size, simple shell | 73 (was 12), 63 |
| 10.6 | AI panel in plain words | 35 | the escalated plain drawer (`ai-panel-plain`) gets the a11y sweep + layout check in both themes, with the "what is sent" strip and "Answered by the AI service" asserted |
| 10.8 | Beginner journey | 60 (extended by WP 10.8) |

## Feature cleanup (Unreleased)

Removed (their rows above are struck through): group consolidation (6.5), the report builder and
scheduled packs (6.1), the MCP server and agent inbox (5.7), budgets, loan schedules, the AI evals
(5.8), the year-end repair tool, interest on overdue bills, the fixed-asset register and payroll PF / ESI / PT (audit A13b). Hidden until a company has their data:
cost centres, cheque books + PDC + bulk payment files and the trade
cycle — the scenarios that drive one (11, 24, 26, 28, 31, 69) start with
`h.useFeature(name)`, which turns it on as an owner does (Settings → Features → More features →
Turn on); 32, 34 and 72 make theirs used by their own first entries. The hiding itself
is covered by `__tests__/hiddenFeatures.test.tsx` and `featureUsage.dbtest.ts`.

## Upgrade plan to 1.0

| Phase | What | Scenario | Notes |
|---|---|---|---|
| 2c | HSN / SAC search in the New product box (simple): words → the GST portal list (loaded on demand) → ↓ + Enter picks a code, saved on the product; no rate suggested | 50 | the list's integrity / search / checks are in `hsnMaster.test` / `hsn.test` / `__tests__/hsnInput.test.tsx`; the capture note in `capture.dbtest` |
| 4 | GST gateway in test mode (built-in Test GSP): a bill → IRN → e-way bill (e-Documents → Portal (test)) → GSTR-1 signed in, sent, checked, filed with EVC → ARN labelled as a test → GSTR-2B fetched into the screen's matcher | 75 | the simulated IRN never reaches the voucher / e-documents list; a test filing / 2B never counts as real (asserted). GSTR-3B offset + file, the simple Taxes portal step, refusals and the adapter contract are in `gateway.dbtest` / `testGsp.contract.test` / `__tests__/gatewayUi.test.tsx`. A real GSP sandbox: manual workflow `gsp-sandbox.yml` once an adapter exists |
| 3b | One approval queue: two chat drafts → the AI panel's link → the accountant queue (accounts with Dr / Cr) → Approve (saved, draft consumed) / Discard (nothing saved); simple mode Money → Things to approve: an Ask Total offer in plain words → Approve (simple:post) | 76 | the save path per kind, refusals (lock: no voucher, no GST ledger, no audit row), Ask Total / memory approvals in `ai/approvalQueue.dbtest.ts`; both views, Approve all (unrequested left out), Edit targets, hi / hinglish sentences in `__tests__/approvalQueue.test.tsx` |
| 3b | Tasks → plans, no AI key: "remind everyone 30 days late" in Ask Total → the answer in words → Prepare them → Things to approve shows one group headed by the task → Copy the message → logged as on the person's page, nothing posted | 77 | the agent's `plan_task` (mock), refusals, "book … bills", discard and sending twice in `ai/plans.dbtest.ts`; classifier phrasings in `assist/corpus.test.ts`; reminder cards / WhatsApp link in `__tests__/approvalQueue.test.tsx` |
| A10 | Share a bill + UPI pay QR: Settings → Bills & printing → UPI ID (a wrong one refused under the field) → the print carries “Pay by UPI” for what is still due (₹680 of ₹1,180), none on a paid bill → the bill view's Share → WhatsApp (PDF shown in Finder, wa.me with the message) / E-mail (mailto:) → the full sales editor has Share too | 78 | the QR payload / amount in `shared/upi.test.ts`, prints byte-identical without a UPI ID in `print/render.test.ts` + `services/upiShare.dbtest.ts` (due from the Outstandings allocation, credit notes never, audit), the share channels (share sheet, refusals) in `ipcShare.dbtest.ts`, messages en / hi / hinglish in `shared/billShare.test.ts`, the buttons + the AI costs' dollar rate in `__tests__/shareBill.test.tsx` |
| A13c | One Checks screen (Analysis → Checks: Month-end close / Anomalies / Exceptions / Stale documents (orders on) / GST 2B mismatches (registered)) — the close checklist, 2B and anomalies (44), the exception reports (68's Stock reports → Exceptions button, 69's missing narration), stale quotations closed (28), Home's "Needs attention" row (52), the tour (02); `h.gotoChecks(tab)` | 02, 28, 44, 52, 68, 69 | tabs per feature / registration, the old names (`assistants`, `exceptions`, `stale-documents`) opening their tab, saved options / views on their old keys in `__tests__/checks.test.tsx`; the sidebar rows in `accountantSidebar.test.tsx` |
| 3b | ONE Ask panel in both modes: ⌘J → Ask Total first (AI off: no way to a model, 35), "Ask the AI helper instead" → the AI conversation (`h.openAiChat()`, 35 / 41 / 43 / 76), the "To approve" tab with its count → Open the full list (76) | 35, 76 | tab switching, accountant routing and Back to Ask in `__tests__/askTotal.test.tsx`; the accountant AI conversation unchanged once open in `simpleAi.test.tsx` |

## Remaining gaps (deferred)

- Live NIC IRN / e-way generation against the real sandbox (no credentials; the fake NIC covers the
  connection test only).
- Price-list editor UI and party-wise rates are set up over IPC in 29 (the counter flow is UI).
- TDS lower-deduction certificates (DB-tested in `withholding` dbtests, no UI scenario).

## App bugs the new scenarios found

Fixed in this PR: **MT940 / CAMT.053 statements could not be imported** (Banking → Import kept
"Apply the mapping first" for any statement without a column mapping) — e2e 72 tests the fixed path.

Fixed in PR #107 (`fix/year-end-ui-bugs`, merged while this WP ran). The scenarios were written
with workarounds; the review switched them to assert the fixed behaviour where that was cheap:

| Bug | Scenario | Now |
| --- | --- | --- |
| Settings → Period lock is not editable in a company without users | 67 | runs in a company with no users and changes / removes the lock from Settings → About (the lock-screen sign-in stays covered by the other scenarios) |
| The closing journal's Delete is disabled in its editor (inside the read-only fieldset) | 67 | bins it from the banner's Move to Bin; asserts the lock moves back to the day before the FY |
| The editor's pre-save duplicate-number check ignores the financial year | 67 | re-saves last year's No. 1 (the same number as this year's April payment) |
| Stock ageing uses the period END as its as-on date | 68 | the working period stays the whole FY; ageing is as on today |
| Cost-centre report's Net Dr / Cr label is inverted | 69 | asserts a loss reads Dr |
| Import undo leaves the openings unequal (kept masters keep imported openings) | 71 | asserts the kept masters' openings are cleared and the openings tie |

## Date robustness

The app's "today" is the machine's LOCAL date. Scenarios take theirs from `localToday()` /
`fixedToday` / `relativeDate(n)` in `scripts/lib/harness.mjs` (never `toISOString()`, which is the
UTC date), and never clamp a relative date to the financial-year start: a scenario that needs a bill
N days old starts the books early enough (`h.pickSetupStart(N)` in the setup wizard,
`booksStartCovering(N)`; the full company form takes `createCompanyUI(name, { coverDaysBack: N })`,
an already open company `h.coverDaysBack(N)`; `TOTAL_E2E_EARLY_BOOKS=1` forces that branch for a
check on any day). CI runs the e2e job with `TZ=Asia/Kolkata`.

To run a scenario as if on another day, set `TOTAL_E2E_TODAY=YYYY-MM-DD`: the app's clock (main and
renderer, `src/shared/e2eClock.ts` — honoured only with `TOTAL_DATA_DIR` in an unpackaged build)
and the harness's `localToday()` move to that day, and the harness checks both processes see it
before the scenario starts. SQLite's own `'now'` (column defaults such as `vouchers.created_at`,
`datetime('now')` in updates) follows it on every connection `openDb` opens, and file times compared
with today (backup age, stale locks, sweeps) go through `fileTimeMs`, so nothing is half-shifted. A
scenario must not end with unsaved answers on screen (it fails; `{ allowUnsavedOnClose: true }` if
it means to). E.g. `TOTAL_E2E_TODAY=2027-04-05 node scripts/run-e2e.mjs 32 33 57 59`
(1 April – mid May is where a relative bill used to fall into the previous financial year).

## "The app did not close within 20 s — killing it"

This harness line (`Harness.close`, after #128) is not a scenario problem and not specific to one
scenario — it has been seen after 48, 58, 59, 62, 69, 70 and 71, always in runs where the machine
was saturated (other agents' builds and tests; the scenarios themselves ran 3–4× their usual time).
Traced in the #148 review by reproducing it with a bare launch → demo company → close loop under
16 CPU-bound processes on the 8-core laptop, with `before-quit` / `will-quit` / `quit` / `exit`
listeners and a `sample` of the main process 6 s into the close:

- the app's own quit path finishes in ~150 ms every time, hung or not — `before-quit` (the quit
  backup, `closeCurrentCompany`) → window closed → `will-quit` → `process.on('exit')`;
- the main process then stays up inside Electron / Chromium's native teardown: its main thread is
  blocked in `mach_msg` (the browser shutdown waiting on another process), in `v8::Isolate::Dispose`,
  or in `exit()`'s static destructors messaging a system daemon (PowerLog) — no app code, no SQLite
  frame on any thread;
- it happens just as often with no backup check (or any worker) running at quit, so it is not the
  restore check / quick_check worker or `simple:homeAttention`.

On an idle machine the same loop closes in 0.2–0.8 s (59 alone: 0.3–0.7 s, three runs). The 20 s
kill only bounds the wait; the scenario's result line is already decided, so nothing is lost. If the
line shows up on an idle machine, sample the main process (`sample <pid> 2`) while the harness waits.
