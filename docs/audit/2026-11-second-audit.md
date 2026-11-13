# Total — second whole-product audit, November 2026

13 November 2026 · code at `main` 8aa63297 (after #267) · independent audit: the auditors did not write this code.
Follows the [first audit](2026-11-audit.md) (7 November, `main` 0614071a). Since then 275 commits and 47 merged PRs (#219–#267).

**Scope.** (1) The status of every finding of the first audit. (2) New findings in what merged 8–13 November: A1–A13, the Phase 5 speed and polish work, the A11 lint and code health, the Phase 2d GST items, and the Phase 6 preparation. (3) A ranked "before 1.0" list and the owner's questions.

**Method** (the first audit's, repeated):
- **Security:** read the code. A throwaway script (TypeScript compiler API) listed every `handle('<channel>', …)` registration in `src/main`: **665 handlers** (the first audit counted 695; #243 removed the cut features' channels) with their role and whether the handler parses its payload, compared with `AUDIT_COVERAGE` and the pinned `__fixtures__/ipcChannels.json`. `npm audit --package-lock-only` on the app and on `site/`. One independent sub-auditor read the security-relevant diffs.
- **Correctness:** static analysis of the engine, services and editors changed since 7 November, every finding tied to a `file:line`. One independent sub-auditor read the money paths. No test suite was run (laptop limits); claims were checked by reading the code.
- **UX:** `npm ci` + `npm run build` once, then the BUILT app was driven by a scratch Playwright driver over `scripts/lib/harness.mjs` (scratch `TOTAL_DATA_DIR`, test secrets, never `~/Documents/total`). Two runs: (A) first run → "Try with sample data" → every simple section, Stock, People, Reports, Taxes, Make a bill, Money in, Ask Total, Help, ⌘K, Business details, dark theme, 1024×700 → switch to the full app → Gateway (light and dark), sales voucher, GSTR-1, GSTR-3B, trial balance, P&L, Outstandings, Checks, Settings, ⌘O switcher, the Ask panel; (B) the wizard ("starting fresh", regular GST) → empty Home → Taxes → first bill → Home after the bill → Money out, Record a purchase, Help, dark Make a bill, How Total looks. The repo's own `sweepInPage` / `layoutInPage` and the banned-word list ran on every screen. 51 screenshots are in `~/.claude/total-orch/shots-audit2/` (not in the repo).
- **Product:** the screen registry and features against the first audit's comparison (Tally Prime, Vyapar, myBillBook, Zoho Books, Busy); no new vendor research.

**Bottom line.** **Most of the first audit is done.** Of its 69 findings, 39 are fixed, 10 partly, 17 not, and 3 were accepted or left unchanged by choice (counted in §1). Of its "top 10", nine are done in full. #3 (Electron hardening) is done except the optional preload allowlist (SEC-18) and the print HTML's CSP `<meta>` (SEC-14). Notarisation (SEC-5) was never part of the top 10; it waits for the Apple Developer ID. Every money finding the owner asked for (COR-1 Outstandings, the SEZ / export tax) is fixed with hand-worked tests. The new Electron hardening, the lock / user-switch clearing and the site fixes hold up when the code is read. The IPC surface is clean:
- 665 handlers; every one parses its payload or takes none;
- every write channel is mapped in `AUDIT_COVERAGE`;
- every role equals the pinned fixture;
- no viewer channel writes the books.

**Nothing critical, and no high-severity finding.** What is left for 1.0:
- **Update integrity is only half solved.** The new signed manifest is checked fail-closed by the app, but the signing key is a repository secret that anyone who can push to the repository can reach (SEC2-1). On macOS the bytes the user actually installs are never checked (SEC2-2). A packaged build probably still accepts `--remote-debugging-port` (SEC2-3, to confirm).
- **One new GST figure bug.** A debit note keeps the "blocked credit" mark it had when it was saved, so changing a purchase's mark afterwards puts GSTR-3B Table 4 out by the note's tax (COR2-1).
- **Ask Total answers a narrow question with a broad figure.** "Sales of office chair this year" gives the whole year's sales (UX-14, still open, worse example).
- **Five items of the simple-polish package (A9) were never picked up**: the Taxes hub, the ⌘K footer, the test-GSP card, the data-folder label, and Ask Total's narrow questions. The UI-overhaul PRs fixed the rest of A9, but A9 itself has no PR and no `to-do.md` line.
- **The #207 golden-fixture bugs left open**, of which the e-invoice eligibility ones are cheap to fix.

---

## 1. Status of the first audit's findings

Legend: ✅ fixed · ◐ partly · ✗ not fixed · ↺ regressed. "PR" is where it was fixed.

### 1.1 Security & privacy

| ID | Status | Evidence (13 Nov) |
|---|---|---|
| SEC-1 devtools in production | ✅ #225 | `index.ts:141` `devTools: !app.isPackaged`; `windowPolicy.ts:32` (`=== true`); packaged menu without reload / toggle devtools (`windowPolicy.ts:108-124`, `index.ts:185`). See SEC2-3 for the remaining debug switch. |
| SEC-2 query cache outlives a lock | ✅ #238 | `lib/companyCache.ts:36-52` `bindQueryCacheToSession` clears the cache and runs the `onSessionEnd` resets when `locked` turns true or a different user signs in; bound in `main.tsx`. |
| SEC-3 `company:open` path traversal | ✅ #238 | `companySlugSchema` (`schemas.ts:44`) plus the registry check on open, delete and forget-remembered (`ipc.ts:602, 661-664, 687-689, 743-744`). |
| SEC-4 NIC secrets not bound | ✅ #225 | `shared/nicEndpoint.ts` (https, http only on loopback), secrets bound to both origins + PEM hash, `redirect: 'error'` (`nic.ts:394`). |
| SEC-5 update integrity | ◐ #251 | Signed Ed25519 manifest, checked fail-closed: missing / non-200 manifest → not offered (`updater.ts:56-61`, `updaterCore.ts:122-132`); exact version (`releaseManifest.ts:76`); downgrade refused (`updaterCore.ts:160-161`). Still open: builds are not notarised, the key is online (SEC2-1), the hand-download bytes are unchecked (SEC2-2), and no human review is required on release-machinery PRs (no CODEOWNERS, no branch protection). |
| SEC-6 Electron fuses | ✅ #225 | `package.json:89` `electronFuses`; `scripts/fuses.mjs check` in release (mac `release.yml:112-116`, win `:173-177`) and CI Windows (`ci.yml:273-277`). |
| SEC-7 site XSS | ✅ #242 | React-rendered notes, `safeHref` (`site/lib/notes.ts`); nonce CSP (`site/proxy.ts`, `lib/security.ts`); no `dangerouslySetInnerHTML`. |
| SEC-8 delete at the privacy lock | ✅ #238 | Refused under the privacy lock (`ipc.ts:615`); passphrase always asked (`ipc.ts:624`, `evenIfKnown`). |
| SEC-9 weak `.totalbak` KDF | ✅ #251 | `TOTALBK2`, N = 2^17, cost in the header and AAD (`db/crypt.ts:5,15`). |
| SEC-10 unvalidated update URL | ✅ #251 | The updater's only `openExternal` is `openUpdatePage` → `allowedUpdateUrl` (`updater.ts:70-74`). |
| SEC-11 margins without `canSeeProfit` | ✅ #238 | `capabilities.ts:36-38` (`manufacture:margin`, `manufacture:register`, `cc:report`). |
| SEC-12 agent mirror | ✅ #238 | Documented (`docs/security/encryption-at-rest.md:154`); every `scheduleMirrorRefresh` passes `canSeeProfit`; never written for a passphrase-locked business. |
| SEC-13 PIN throttle | ◐ #238 | Backoff 30 s → 1 / 5 / 15 min (`users.ts:151-157`). Still a 4-digit minimum for owners (`schemas.ts:680`) and scrypt N = 2^14 for the PIN hash (`services/authcrypt.ts:6`). |
| SEC-14 PDF window JS | ✅ #225 (CSP part open) | `javascript: false` (`windowPolicy.ts:95`); no CSP `<meta>` was added to the print HTML (defence in depth only). |
| SEC-15 permissions | ✅ #225 | `hardenSession` (`windowPolicy.ts:206-218`). |
| SEC-16 CSV formula guard | ✗ | `gst/itc04.ts:313-316`, `gst/ims.ts:152-155`, `gst/gstr9.ts:601-604` still quote only `", \n` and never neutralise `= + - @`. |
| SEC-17 waitlist privacy | ✅ #242 | Notice, `/privacy`, `POST /api/waitlist/remove`. The rate-limit salt still falls back to `''` (`site/…/waitlistAction.ts:24`). |
| SEC-18 preload allowlist | ✗ (optional) | `preload/index.ts:20-25` still accepts any `total:<[a-zA-Z0-9:._-]+>`; not exploitable while every `ipcMain.handle` goes through `handle()`'s sender check (`ipc.ts:413-421`). |

**Dependency audit (13 Nov).** Root: 0 critical, 0 high, **14 moderate** (6 on 7 Nov). All of them are the same `minimatch` ReDoS (GHSA-g3hv-75wg-m249). They now come through `electron-builder` *and* the new lint stack (`eslint`, `typescript-eslint`, both added by #256). All are build- and dev-only; nothing ships in `out/`. npm's "fix" is a semver-major downgrade; don't take it. Site: 0.

**IPC sweep (13 Nov).**
- 665 `handle()` registrations across `src/main` (the `ipc*.ts` files plus `ai/ipc.ts`, `ai/capture/ipc.ts`, `assist/ipc.ts`).
- Roles: 335 viewer, 262 accountant, 68 owner. No duplicates.
- Every role equals `__fixtures__/ipcChannels.json`, and every fixture row exists.
- 0 non-viewer or ungated channels lack an `AUDIT_COVERAGE` entry, and no coverage key is stale.
- One handler takes a payload without a visible parse: `receivables:setConfig` (`ipcReceivables.ts:41`). It parses in the service, as on 7 Nov.
- 11 viewer channels have a write mapping. They are 7 exports (all `canExport`-gated except `counter:print`), `session:lock`, and 3 AI chat channels (`ai:send`, `ai:regenerate`, `ai:thread:rename`). Draft and plan tools inside `ai:send` are role-gated per tool, and `plan_task` re-classifies the user's own message (`ai/tools/planTools.ts:30-33`).

### 1.2 Correctness & code health

| ID | Status | Evidence (13 Nov) |
|---|---|---|
| COR-1 `against` on a balance-raising entry | ✅ #233 | `shared/outstanding.ts:151-177` `raiseNamed`, routed from `apply` (`:209-210`); hand-worked tests `outstanding.test.ts:192-273` (11,800 + 1,180 = 12,980, re-open, unknown name). Differential tests vs frozen engines; the cash forecast follows it (`cashForecast.ts:128-160`). The Tally import still works around the old engine — COR2-4. |
| COR-2 tick after full allocation | ✅ #233 | `shared/voucherEdit/billTick.ts` `tickBillAmount`, used by `AccountingEntry.tsx:370` and `InvoiceEntry.tsx:401`; `billTick.test.ts`. |
| COR-3 bill total defined two ways | ✗ (known, #207a) | "Sum of debits": `gst.ts:379` (GSTR-1 `val`, the B2CL test), `gst.ts:274`, `edocs.ts:105,293`, `vouchers.ts:325,1240,1349,1376`, `caPack.ts:180`, `reports.ts:276`. "Party line": `shared/simple/saveCard.ts:14-20` `billAmount`, now also used by A10's share facts and the bill views' `added`, so the gap widens with each new reader. Golden B2B-06 still `knownBug` (`gstGolden/fixtures.ts:61`). Figure change: needs the owner. |
| COR-4 UTC "today" in the renderer | ✗ | Unchanged: `BulkEdit.tsx:155`, `TransportModal.tsx:196`, `Capture.tsx:251`, `banking/ImportTab.tsx:436`, `ipcDataImport.ts:112`, `log.ts:20`. No new site was added. |
| COR-5 float money products | ✗ | `shared/valuation.ts:127,144,173,193`, `pricing.ts:184`, `voucherEdit/invoice.ts:248` still `Math.round((a*b)/c)`; deferred to the owner's "one rounding rule" (to-do §6, HEALTH-6). |
| HEALTH-1 dead code | ◐ #260 | `ReportConfigButton`, `gst.inwardSummary`, the forex writer maths, the dead i18n keys and `@electron-toolkit/preload` are gone. Left: `importwiz:templateSave` (`ipcDataImport.ts:224`) and `gateway:ewb:extend` (`ipcGateway.ts:90`) still have no renderer client (to-do §6). |
| HEALTH-2 private date helpers | ◐ #260 | About 25 copies replaced by `dates.ts:172-181` `addDaysISO` / `daysBetweenISO`, each byte-equivalent (no behaviour change). The inline maths listed in to-do §6 is left (e.g. `outstanding.ts:45`, `ai/tools/screenTools.ts:63`). |
| HEALTH-3 side / bank by group name | ✗ | `voucher/hooks.ts:65,70`, `services/counter.ts:94` (to-do §6: changes defaults for imported charts). |
| HEALTH-4 god modules | ◐ #252 | `ipc.ts` 3,677 → 1,669 lines, 432 → 50 handlers, split into `ipc<Area>.ts`. Still large: `intents.ts` 1,489, `gst.ts` 1,265, `InvoiceEntry.tsx` 1,233, `client.ts` 1,570, `screens.ts` 1,571. |
| HEALTH-5 test gaps | ◐ #233 / #254 / #260 | Added: the A1 positive-`against` cases, the tested tick helper, `services/notDeletedLint.test.ts` (+ `sqlStrings.testutil.ts`). Open: the unit-test CI job still runs in UTC (no `TZ` in `ci.yml` `test`; only the e2e steps have `TZ: Asia/Kolkata`, `:131,:173`); `gstItcReversal`, `gstRcm` and `gstAnnual` still have no test file of their own; they are reached only through the `gstExpansion` / `itcBlocked` / `taxFacts` dbtests. (The first audit's claim about `bankImport` / `tallyImport` was wrong: `tallyimport.dbtest.ts` and six `tally*.dbtest.ts` files test the Tally import, and `bankingDepth` / `simpleBank` / `simpleBankRollback` dbtests drive `bankImport`.) |
| HEALTH-6 four rounding rules | ✗ | Unchanged; deferred for the owner's figure sign-off (to-do §6). |
| HEALTH-7 e2e sleeps, no e2e on PRs | ✅ #257 | 0 `waitForTimeout` in `scripts/` (enforced by `scripts/lib/noSleeps.test.ts`); PRs run e2e `01 03 06 48 53 55` (`ci.yml:127-128`); every job has `timeout-minutes`. CI is still Node 22 (the local machine runs 26). |
| HEALTH-8 main-thread SQLite, slow launch | ◐ #253 | Window created before `registerIpc` (`index.ts:199-201`); `openai` / `electron-updater` required on first use; launch → Home shown 0.93 s at 100k (`docs/perf-budgets.md:62`). Reports still run on the main process; nothing moved to a worker. Measured here (scratch data dir, this laptop, Playwright attach included): first launch 3.1 s to `window.total`, second 1.4 s; sample company → Home 0.8 s; wizard finish → Home 0.3 s. |
| HEALTH-9 no linter | ✅ #256 | `eslint.config.mjs`, `npm run lint` in CI (`ci.yml:37-38`); every one of the 74 `eslint-disable`s in `src/` (outside the frozen fixtures) gives its reason (`shared/eslintReasons.test.ts`). `edocs.ts:110,114` keep `any` (the retype was not done).

### 1.3 UI & UX

| ID | Status | Evidence (13 Nov) |
|---|---|---|
| UX-1 Home's first step opens the accountant form | ✅ #248 | Settings → Business details is `simple-business` (`simple/SimpleBusiness.tsx`); run B's empty Home "Add your business details" opens it in the simple shell. |
| UX-2 sample company looks broken | ✅ #248 | Run A: "Day-one figures entered", 6 products all ≥ 0 with selling prices (A4 Paper 19 Box ₹4,180 … stock worth ₹2,03,030), November cost of goods ₹72,810, profit ₹2,229.70. Simple Stock says "Sold more than recorded" for a product below zero (`LevelChip`). |
| UX-3 sales party picker lists every ledger | ✅ #249 | `shared/voucherEdit/partyList.ts` `partyPickerLedgers`; the picker no longer opens on arrival (run A, `A-42`). |
| UX-4 GST returns open on the running month | ✅ #249 | Run A on 13 Nov: GSTR-1 opens on **October 2026** (`A-44-gstr1.png`), the period `gst:duePeriod` names. |
| UX-5 section pages are link farms; Taxes is hand-offs | ✗ | Run A/B, Taxes section: "GST to pay — GSTR-3B →", "GST on your sales — GSTR-1 [Full app]", "Check supplier bills … [Full app]" — no figure, no due date, even on a fresh company (`B-05-taxes-empty.png`). The other hubs are unchanged lists. A9's remaining items have no PR and no line in `to-do.md` (PROC2-1). |
| UX-6 amounts and sentences in monospace | ✅ #223 | `app.css:301-305` `.num` is Geist with `tabular-nums`; mono only for codes. |
| UX-7 autofocused pickers open over the form | ✅ #232 | Make a bill / Money in / sales voucher: the field has focus, the list stays closed (`A-24`, `A-25`, `A-42`). |
| UX-8 crowded simple header | ◐ #226 | Theme is now a moon / sun icon; the period chip is gone from entry screens; on Make a bill "Accountant view" sits in the page header. Still: Home's header keeps 7 controls (period, Accountant view, ⋯, Ask Total, Help, theme, Search) and the business name still starts ~96 px right of the sidebar's logo (`A-02`). The full app's theme chip is still labelled with its target ("Dark" while light, `A-44`). |
| UX-9 fresh business nagged about GST | ◐ #248 | No October nag after the first bill (run B), and the tile is the running period. **But the tile now says "So far this quarter: ₹90.00" to a MONTHLY filer, with no due date** — new finding UX2-1. |
| UX-10 TB / P&L / BS defaults | ✅ #249 | TB "as on 13-Nov-26", "Group-wise" switch, "Stop at today" note; "Compare periods" in the P&L header (`A-46`, `A-47`). Grouped is a switch, not the default (owner's choice in A8). |
| UX-11 accountant sidebar overflows and scrolls away | ✅ #230 / 9a0cee9f | Top block pinned, sections collapse; on Settings the nav did not scroll (`scrollTop 0`). |
| UX-12 company switching is a full-screen trip | ✅ #250 | ⌘O opens `CompanySwitcher` (`A-51`). |
| UX-13 People chips clipped, "credit" ambiguous | ✅ #234 | "₹10,502.00 late · 4 days" whole (`A-21`); the chip says who holds the credit. |
| UX-14 Ask Total broadens a narrow question | ✗ | `assist/classify.ts:626-628` still maps any "spend" to all expenses and any "sales" to all sales. Run A: "how much did I spend on diesel" → "Your day-to-day costs came to ₹12,350.00 …"; **"sales of office chair this year" → "You sold ₹5,63,230.00 from 1 Apr 2026"** — the whole year's sales presented as the chair's (`A-52-acct-ask-panel.png`). Worse than the first audit's example: a confident wrong figure. |
| UX-15 Home quick actions look disabled | ✅ #248 / #226 | "+ Sale" is the filled primary; the other three are white cards with icons (`A-02`). |
| UX-16 save bar differs between flows | ✅ #235 | Money in / out / move have the Save bar with the amount (`B-10-money-out.png`). |
| UX-17 English, technical ⌘K footer in simple mode | ✗ | Run A, simple company: footer "Filters: amt:>50000 date:apr fy:2026 type:sales gstin:27AAP party:acme" (`A-28-palette.png`; `CommandPalette.tsx:419`). |
| UX-18 tab order walks through e-way fields | ✅ #249 | Run A tab order: number → date → party → ledger → item → qty → rate → discount → narration → GST details → **Save** → Save + PDF → Cancel. |
| UX-19 test GSP card above every return | ✗ | "Send to the portal (test mode) · Sign in to the portal (OTP)" still sits above GSTR-1 and GSTR-3B figures (`A-44`). |
| UX-20 mixed K / L abbreviations | ✅ #237 | Gateway: "Cash ₹13,338 · Bank ₹4L", "₹5.6L · ₹4.6L" — no K. |
| UX-21 first-run screen offers too many exits | ✅ #248 | One "Try with sample data" button and one "I'm an accountant, or I have a backup" line (`A-01-first-run.png`). |
| UX-22 hard-coded data folder on the company list | ✗ | `CompanySelect.tsx:161`, `settings/AboutSection.tsx:79`, `CompanyInfo.tsx:238`, `AgentBridgeSection.tsx:135` print `lib/platform.ts` `dataFolder` = the literal `~/Documents/total` (`shared/updateText.ts:12`), wrong after the data-folder move that PR #133 added. |

### 1.4 Product

| ID | Status | Evidence |
|---|---|---|
| PROD-1 five AI doors | ✅ #221 / #229 / #231 | One "Ask" panel (⌘J, both modes) with Ask Total first and a "To approve" tab (`A-52`); one approval queue; Checks holds the assistants. Explain-this still opens the AI conversation directly (by design). |
| PROD-2 six ways to make a sale | ✅ #240 | Quick bill folded into Make a bill (scan box, F5–F7, change due); the full app's Counter stays. |
| PROD-3 hidden features | ✅ #243 | Interest on overdue bills, the fixed-asset register and payroll PF / ESI / PT cut; old books read as before (`cutFeaturesRead.dbtest.ts`). |
| PROD-4 too many analysis screens | ✅ #245 | One Checks screen; item demand and three-way match only with orders on (`lib/screens.ts:311-329`). |
| PROD-5 accountant help | ✗ (deferred) | Help is still simple-mode only (`to-do.md` §6, WP 10.3). |
| PROD-6 payroll | — accepted (unchanged) | Still a feature flag (off for wizard companies); salary is a Money out category. |
| PROD-7 / PROD-8 share the bill, UPI QR | ✅ #239 | `invoice:share`, `upi:set`, QR on the A4 print and receipt. |
| PROD-9 live e-invoice / e-way | — accepted | Sandbox only (owner); the "test mode" wording is shown (but see UX-19). |
| PROD-10 phone / second device | — accepted | Offline by design. |
| PROD-11 thermal / scan box | ◐ #240 | Scan box in Make a bill done; still no 58 mm template (`shared/printTemplates.ts` has 80 mm only). |
| PROD-12 usage insight | ✗ | No opt-in local usage list. |
| PROD-13 IMS | ✗ (post-1.0) | — |
| PROD-14 TDS returns | ✗ (post-1.0) | — |
| PROD-15 bank feeds | ✗ (post-1.0) | — |

**Still open from the first audit's "also worth knowing":** seven `knownBug` marks in `src/main/services/gstGolden/fixtures.ts` (lines 61, 194, 264, 498, 506, 523, 540). #244 fixed the SEZ / export ones. Left: the rounded-down bill's GSTR-1 `val` / e-invoice `TotInvVal` (COR-3), rupee-typed tax recomputed at the inferred rate, **three e-invoice eligibility gaps** (a nil-rated bill of supply, a composition dealer's bill and an unregistered business's sale all go into the e-invoice export — the last with no seller GSTIN, so the JSON fails the official schema), and advances' tax left out of GSTR-3B 3.1(a) (a CA question).

---

## 2. New findings since 7 November

Severity: critical = exploitable now, data loss / exfiltration / RCE · high · medium · low.

| Area | Critical | High | Medium | Low |
|---|---|---|---|---|
| Security & privacy | 0 | 0 | 3 | 4 (one informational) |
| Correctness | 0 | 0 | 1 | 3 |
| UI & UX | 0 | 0 | 1 | 3 |
| Process | 0 | 0 | 0 | 1 |

### 2.1 Security & privacy

#### SEC2-1 — Medium (high impact) — The release-signing key is online: anyone who can push to the repository can reach it and sign a release
- **Evidence:**
  - `.github/workflows/release.yml:9-12` runs on any pushed `v*` tag.
  - The `sign-and-publish` job (`:201-228`) has no `environment:` with required reviewers. It checks out the workflow's own ref, which on a tag push is the tag's tree. It then runs *that tree's* `scripts/release/manifest.mjs` with `RELEASE_MANIFEST_KEY` in its environment, under `actions/setup-node@v4` (a mutable tag, not a SHA).
  - `.github/` has no CODEOWNERS, and CLAUDE.md says main has no branch protection. Agents may merge their own PRs, and a merge on main is released automatically at the next 12-hour slot.
  - **More widely:** `RELEASE_MANIFEST_KEY` is a *repository* secret. GitHub gives it to any workflow run in the repository (forks aside), including one started by a push to any branch. On top of that, `release.yml:25-30` also has `workflow_dispatch`, and the sign job's checkout has no `ref:`. So "Run workflow" on a feature branch runs that branch's `manifest.mjs` with the key. No tag, PR or merge is needed.
- **Failing scenario:** a leaked write token (or a merged malicious PR) pushes `v0.99.0` built from changed code. `release.yml` builds it and signs it with the real key, every app built since A4 verifies it, and users install it. That is SEC-5's own scenario. The same token could instead push a branch with a workflow that prints the secret, or dispatch Release on that branch, and take the key itself.
- **What #251 does protect against:** a Vercel compromise, and assets swapped after signing, but **only on the electron-updater path** (`updaterCore.ts:196`). The hand-download path is SEC2-2. It does not protect against a repository compromise.
- **Fix — only two things close it:**
  - (a) sign on the owner's machine with a key that never reaches GitHub (`manifest.mjs sign`); or
  - (b) move the secret OUT of the repository secrets into an **Environment** secret, with the owner as required reviewer AND deployments restricted to `v*` tags.
  - Defence in depth on top of either: tag protection for `v*`, SHA-pinned actions, and a CODEOWNERS file covering `.github/`, `scripts/release/`, `package*.json` and `src/main/releaseKeys.json`. On their own these do not close it.
  - Both (a) and (b) cost the fully automatic 12-hour release (owner question Q1).

#### SEC2-2 — Medium — The installer downloaded by hand (always on macOS; on Windows when the engine path fails) is never checked against the signed manifest
- **Evidence:** for the hand-download path, `updater.ts:103-106` / `updaterCore.ts:136-139` open the GitHub URL of the installer the manifest names, and the browser downloads it. This is the only working update path on unsigned macOS builds. On win32, `installerFor` (`releaseManifest.ts:92`) picks `Total-Setup-<v>.exe` whenever an engine download or install fails and the notice falls back to the release page. The SHA-512 check exists only on the electron-updater path (`updaterCore.ts:189-213`).
- **Failing scenario:** after a release is signed, someone with write access runs `gh release upload v0.12.5 Total-0.12.5.dmg --clobber`. The manifest still verifies, so the app offers the update and opens that URL, and the user installs the replaced DMG.
- **Fix:** download the installer in main, check its SHA-512 against `manifest.assets`, then reveal the verified file. On a mismatch, show a plain error and never open the page.
- **Order of fixes:** while SEC2-1 stands, an attacker with write access can simply sign a new release, so this finding matters once SEC2-1 is fixed. A cheap stop-gap for this `--clobber` swap and for SEC2-4's draft-asset swap is GitHub's immutable-releases setting.

#### SEC2-3 — Medium (to confirm on a packaged build) — A shipped build probably accepts `--remote-debugging-port`, which reopens what SEC-1 / SEC-6 closed
- **Evidence:**
  - Nothing in `src/main` inspects `app.commandLine` (a grep for `remote-debugging` / `hasSwitch` finds nothing), and Electron has no fuse for this switch.
  - `scripts/fuses.mjs test-copy` turns back on only the Node `--inspect` fuse, yet the packaged smoke drives the renderer through Playwright's CDP attach (`release.yml:179-184`, `scripts/smoke-ci.mjs`). So CDP works on a packaged build with `devTools: false`.
- **Failing scenario:** malware running as the same macOS user starts `Total.app/Contents/MacOS/Total --remote-debugging-port=9222`, attaches CDP and calls `window.total.invoke('company:open', { slug })`. A business whose passphrase is "remembered on this computer" opens without it (`ipc.ts:713` `unlockFolderIfNeeded` tries the remembered key). It can then read everything, and in a business without users it can also write. The first audit rated the same reach through the devtools menu as the root of SEC-2 / SEC-3 / SEC-8.
- **Fix:** early in `main/index.ts`, in packaged builds, `app.exit(1)` when `remote-debugging-port` or `remote-debugging-pipe` is present (the fuse-flipped smoke copy can be told apart by its inspector fuse). Confirm once by launching the DMG build with the flag.

#### SEC2-4 — Low — Release build jobs keep a write-scoped token on disk while running third-party code
- **Evidence:** `release.yml`'s build jobs check out with the default `persist-credentials: true` under `contents: write`, then run `npm ci`, the tests and electron-builder. `sign-and-publish` then signs "the files as GitHub now holds them".
- **Failing scenario:** a compromised dev dependency reads the token from `.git/config` and swaps a draft asset before the signing job runs. The swapped file is then signed as genuine. The same token can push to the unprotected main.
- **Fix:** set `persist-credentials: false`, and pass `GH_TOKEN` only to the upload steps. Also add `permissions: contents: read` to `ci.yml`, which has no `permissions:` block (whether a push run gets a write token there depends on a repo setting not visible from the code).

#### SEC2-5 — Low — The update engine accepts a download that matches ANY asset in the manifest
- **Evidence:** `releaseManifest.ts:108-110` `assetWithHash` returns any listed asset whose SHA-512 matches; `updaterCore.ts:196` uses it to decide "ready to install".
- **Failing scenario:** whoever controls `latest.yml` could point Windows at another signed asset of the same release (the mac zip, the manifest). No code-execution path is visible today; this is hardening.
- **Fix:** require the expected name too (`Total-Setup-<v>.exe` on Windows, the mac zip on macOS).

#### SEC2-6 — Low (maybe intended) — With "Remember on this computer", close + reopen gets past the privacy lock's passphrase
- **Evidence:** `session:unlock` asks for the passphrase at a privacy lock. But `company:close` / `company:open` are ungated, `closeCurrentCompany` clears `privacyLock` (`ipc.ts:304`), and the reopen uses the remembered key (`ipc.ts:713`).
- **Failing scenario:** a business with no users and the passphrase lock on, with "remember" ticked, sits at its privacy lock. Anyone at the Mac clicks Switch business and reopens it, and is in without the passphrase.
- **Fix:** while a privacy lock was set this session, don't use the remembered key on the next open; or say plainly in Lock and safety that "remember" makes the screen lock a curtain, not a lock (owner question Q6).

#### SEC2-7 — Informational — Prefetch responses skip the site's CSP
- `site/proxy.ts:22-28` skips requests marked `next-router-prefetch` / `purpose: prefetch`, so those responses have no CSP header. This is Next.js's documented pattern, and an attacker cannot set those headers on a victim's navigation. Noted only for completeness.

### 2.2 Correctness

#### COR2-1 — Medium — A debit note keeps the "blocked credit" (s.17(5)) mark it had when first saved, so GSTR-3B Table 4 goes wrong when the purchase's mark changes later
- **Evidence:**
  - `services/vouchers.ts:601-633` `resolveItcBlocked`. A NEW debit note copies the mark only when *every* purchase it returns is marked (`:631-633`). An edit keeps whatever it had (`:611`), because the editors leave the field out unless it is ticked.
  - Marking or unmarking a purchase never revisits its debit notes.
  - `bookedItcByVoucher` buckets each voucher by its own column (`gst.ts:685`), and `circular170Inputs` (`returns.ts:905-914`) sends blocked credit to 4(A)(5) and reverses it in 4(B)(1).
- **Failing scenario (hand-worked):**
  1. Purchase P: ₹1,000 + IGST ₹180, unmarked.
  2. Debit note DN returns half: IGST ₹90, unmarked.
  3. The user later ticks "can't claim" on P.
  4. Result: the blocked bucket holds +₹180 and ordinary credit −₹90, so net 4(C) is **₹90 lower** than it should be (the note reverses credit that was never claimed).
  - The reverse order (DN saved while P was marked, then P unmarked) gives 4(B)(1) **−₹90** and 4(C) ₹90 too high.
  - A DN returning one marked and one unmarked bill gets no mark at all, so the marked bill's share also reduces ordinary credit.
  - GSTR-9 reads the same rows (`gstAnnual.ts` `itcDocsFor`).
- **Fix:** derive a debit note's bucket when reading, from its originals (return links / reference / bills set against), splitting the tax by each original's mark. Failing that, when a purchase's mark changes and it has debit notes, warn and offer to update them. The feature merged on 13 Nov (#263), so few books carry it, but the fix moves 3B figures for those that do (owner question Q2).

#### COR2-2 — Low — A data import in "update" mode clears the blocked mark when the file doesn't carry it
- **Evidence:** `services/dataImport.ts:1045` (`voucherInputFor`, shared by every voucher import) states `itcBlocked: vm.itc_blocked === 1` for every purchase and debit note. The review of #263 chose this on purpose ("the workbook is the truth"). The export writes the key only for MARKED vouchers (`booksExport.ts:210`), so in a current workbook an absent key means "not marked". But a Books workbook exported before #263 has no such cell anywhere, and neither does any other file the user maps onto purchases with "update" (the Busy mapping was not traced).
- **Failing scenario:** re-importing an older Books export with "Update matched entries" (opt-in; the default is skip) unmarks every blocked bill. A filed month's 4(A)(5) / 4(B)(1) / 4(C) then move, and the import summary does not say so (the undo restores them).
- **Fix:** tell old files apart at the WORKBOOK level: when no voucher in the file carries the key, the file predates #263, so keep the marks (say so in the summary). Alternatively, have the export write `itc_blocked: 0` explicitly for every purchase and debit note, then treat "absent" as keep. In that case update the books-fidelity expectation by hand. A per-row "absent = keep" would wrongly stop a current workbook from clearing a mark.

#### COR2-3 — Low (plausible; a CA point) — A simple return of an SEZ / LUT bill saved before #244 leaves that bill's IGST owing
- **Evidence:** `shared/simple/intents.ts:781` and `:1232-1233` tax the note by the party's *current* flag (`partyTaxClass` → zero tax). `loadOriginal` reads the bill's posted supply only for its rates (`simplePost.ts:183-187`), and `runningAmountRest` (`:1365`) then gives up on "empty the bill". The accountant credit-note editor does the same through `computeInvoice` → `billTaxClass`.
- **Failing scenario:** an old bill of ₹1,000 + IGST ₹180 to a `sez_wop` party (saved before the rule) is fully returned. The note is ₹1,000 with no tax, so ₹180 stays owing and stays in Output IGST.
- **Fix:** a note set against a bill that loads as `legacyZeroRated` follows that bill's posted tax, as the bill itself does. This touches the UNVERIFIED "credit notes follow their bill" point (`shared/gst/zeroRated.ts` header), so it needs the CA (owner question Q4).

#### COR2-4 — Low — The Tally import still rewrites an Agst Ref on a balance-raising entry, which the engine now handles
- **Evidence:** `services/tallyImport.ts:199-212` still turns a non-settling Agst Ref (a debit note to a customer naming S/1) into a *new* bill named after the entry. This is the work-around written for the engine before A1.
- **Failing scenario:** Tally shows S/1 at ₹12,980. After import Total shows S/1 ₹11,800 + DN/1 ₹1,180. The party total ties, but bill-wise ageing, reminders and the "pay this bill" picks differ from Tally and from the same note keyed into Total.
- **Fix:** pass the `against` ref through when a bill of that name exists (open or settled), now that `raiseNamed` handles it. This changes only books imported after the fix (owner question Q5).

### 2.3 UI & UX (from the two runs)

#### UX2-1 — Medium — Home's GST tile tells a MONTHLY filer "So far this quarter", and drops the due date
- **Evidence:**
  - Run B: regular registration, monthly filing (`setup-filing-monthly`), starting fresh, one ₹500 + 18 % bill. Home's tile reads **"So far this quarter: ₹90.00"**, with no date (`B-09-home-after-bill.png`).
  - `services/dashboard.ts:142-148` `running()` sets `soFar = true` for monthly filers too (added by #248 for UX-9; since 16 Oct, bc58ad1f, also after "I've filed").
  - `shared/simple/explain.ts:165` `gstLine` then always renders `simple.home.gstSoFar` = "So far this quarter: {amount}" (`en.ts:336`; hi "इस तिमाही में अब तक", hinglish "Is quarter mein ab tak"), and never says the date even though the row carries `gstr3bDue`.
  - e2e 80 asserts `soFar` and the period but not the words.
- **Failing scenario:** the owner reads that GST is counted by quarter (wrong for them) and sees no date, though the first audit's fix direction was "₹90 collected this month — due 20 Dec".
- **Fix:** add a monthly so-far branch to `gstLine`, worded from `r.period` (the `gstMonthSoFar` key fits) plus `gstr3bDue`: "November so far: ₹90 — due 20 Dec". `gstPeriodLabel` alone won't do it: it returns at `explain.ts:157` for every non-quarterly row before it reaches `gstMonthSoFar`. Test the words in all three languages.

#### UX2-2 — Low — "Add your first customer or supplier" is ticked by the walk-in cash sale
- **Evidence:** run B: after one cash sale to the walk-in customer, the setup list says "Add your first customer or supplier (done)". `dashboard.ts:227` counts every non-system ledger without a `simple_category`, and the walk-in "Cash sale" ledger made by `ensureWalkIn` is one.
- **Fix:** count only party ledgers (`isPartyLedger` by group role) and leave out the walk-in.

#### UX2-3 — Low — The ⌘K palette has no accessible name and is not a dialog
- **Evidence:** the repo's own `sweepInPage` flags `input[input-palette] ""` as unlabeled (`A-28`). In `components/CommandPalette.tsx:357-372` the input has only a placeholder, and the overlay has no `role="dialog"` / `aria-modal` / `aria-label`. This was the same on 7 Nov; the first audit's sweep did not open the palette.
- **Fix:** `role="dialog" aria-modal="true" aria-label=t('palette.title')` on the overlay, plus `aria-label` (or `role="combobox"` with `aria-controls`) on the input. Add it to the e2e 12 sweep.

#### UX2-4 — Low — The first-run wizard has no landmarks
- **Evidence:** `layoutInPage` on the wizard reports "banner landmarks: 0, no navigation landmark, main landmarks: 0" (`A-01`, `B-01`, `B-02`). A screen-reader user's very first screen has no `<main>`.
- **Fix:** wrap the wizard card in `<main>` and its heading in a `<header>` / `banner`.

### 2.4 Process

#### PROC2-1 — Low — What is left of package A9 (simple polish) has no owner and no tracking line
- **Evidence:** the first audit's §5 gives A9's scope as UX-5, 6, 7, 8, 13, 14, 16, 17, 19, 20 and 22. The UI-overhaul PRs fixed UX-6 / 7 / 13 / 16 / 20 (#223, #232, #234, #235, #237) and part of UX-8 (#226). A9 itself has no PR, and `to-do.md` has no line for it, so the remaining five (UX-5 / 14 / 17 / 19 / 22) were never picked up (§1.3).
- **Fix:** add A9 to `to-do.md` with the five remaining items, and treat UX-14 as correctness (it gives wrong figures), not polish.

### 2.5 Checked and fine (new code)
- **A1 engine (#233):**
  - re-opened bills keep their oldest-first place;
  - refless advance credit nets off an increase first;
  - an unknown name opens its own bill with a warning;
  - `raisesPartySide` signs are right for receipts, payments and both note kinds.
- **SEZ / export (#244):** `billTaxClass` is the one rule. Saved bills round-trip through `legacyZeroRated`. Counter billing goes through `computeInvoice` with `exportType`.
- **ITC blocked (#263):** rule 37, GSTR-9 `itcDocsFor`, s.43B(h)'s deductible share and the RCM refusal all honour the mark. Snapshots don't override it (`taxFacts.ts:224`).
- **MSME day of acceptance (#261):** every s.15 reader goes through `acceptedOnOf`. Writes are refused inside the lock, after today, or past 365 days, and are audited. No row means exactly the old behaviour.
- **Advance-for-goods / blended-rate (#259, #265):** warnings only; `extractOutwardDocs` output is unchanged.
- **Cuts (#243):** interest notes and fixed-asset journals stay immutable except bin. Old PF / ESI / PT dues can only be settled through `oldDuesLeft`. `statutoryDues` is unchanged for the forecast.
- **Sample shop (#248):** built in one transaction, posted only through `postIntent`, and the folder is removed on failure.
- **Approval queue (#221 / #229 / #231):**
  - `ai:queue:approve` is accountant-only and `canPost`-gated;
  - it re-reads the draft and refuses changed figures, TDS cases and duplicates;
  - it saves through voucher:save's own function in one transaction;
  - an `unrequested` draft is never in Approve all;
  - `plan_task` and `assist:plan` re-classify the user's own words, so text in a bill or bank line can't start a plan.
- **Share / UPI (#239):**
  - WhatsApp numbers are digits only and must pass `allowedExternalUrl`;
  - `mailto` addresses are validated and encoded;
  - the UPI VPA is regex-checked, with `pn` / `tn` encoded and `esc()` on the print;
  - `upi:set` is owner-only and audited.
- **File copy (#253):** `execFile('/bin/cp', ['-c', …])` runs with no shell, on app-built absolute paths. The pinned read keeps checkpoints out of the copy.
- **Manifest replay / downgrade (#251):** an older signed manifest names an older version, and `isNewerVersion` runs first, so neither works.
- **Workflows:** no `pull_request_target`. Scheduled-release defaults to `contents: read`. Inputs reach `run:` through `env`. upgrade-matrix regex-checks its tags.
- **Waitlist admin route (#242):** SHA-256 + `timingSafeEqual`, a 24-character minimum, 404 otherwise.
- **Network use:** only `src/main/ai`, `nic.ts:394` and the updater. Renderer requests are filtered (`windowPolicy.ts:213-218`).
- **NOT_DELETED** holds in the new readers (`resolveItcBlocked`, `goodsAdvanceIssue`, `setMsmeAcceptance`): each is filtered or pinned to a voucher id.
- **The two runs, simple screens:** 0 contrast failures, 0 unlabeled controls (except the palette, UX2-3), 0 banned words, 0 console errors, in both themes and at 1024×700.

---

## 3. Before 1.0 — top 10 (ranked)

| # | What | Severity | Findings | Effort | Figures? |
|---|---|---|---|---|---|
| 1 | **Take the signing key out of reach of every repository push.** Either sign offline, or make it an Environment secret (not a repository secret) with the owner as required reviewer and deployments limited to `v*` tags. Then, as defence in depth: tag protection, CODEOWNERS for the release machinery, SHA-pinned actions, `persist-credentials: false` in the release jobs. | Medium (high impact) | SEC2-1, SEC2-4, SEC-5 | S–M | No |
| 2 | **Check the hand-downloaded installer before the user installs it** (macOS always, Windows on fallback): download in main, compare the SHA-512 with the signed manifest, reveal only the verified file. Match the engine path by asset name too. | Medium | SEC2-2, SEC2-5 | M | No |
| 3 | **Refuse `--remote-debugging-port` / `-pipe` in packaged builds** (confirm first with one packaged launch). | Medium | SEC2-3 | S | No |
| 4 | **Ask Total: never answer a narrower question with a broader figure.** When the question names an item, an account or a thing the intent drops, resolve it (search service) or say "I can't split by X yet". | Medium (wrong figures to a beginner) | UX-14 | S–M | No |
| 5 | **Blocked GST credit on debit notes follows the purchase**, read-time derivation, with a before/after report. | Medium | COR2-1 (+ COR2-2) | M | **Yes** (books using #263 only) |
| 6 | **E-invoice export eligibility**: leave out bills of supply (nil-rated, composition) and an unregistered seller's sales. Three golden `knownBug` marks go away. | Medium | #207 (`fixtures.ts:264,498,506`) | S | No (export only) |
| 7 | **One bill-total definition** (COR-3 / #207a): GSTR-1 `val`, the B2CL limit test and e-invoice `TotInvVal` from the rounded party total, under an upgrade diff. | Medium | COR-3 | M | **Yes** |
| 8 | **GST tile for monthly filers**: the right period word and the due date, in all three languages. | Medium | UX2-1 | S | No |
| 9 | **Finish A9** (simple polish): a useful Taxes hub (figure + due date, or open the plain GST screen directly), a plain ⌘K footer in simple mode plus a named palette dialog, the test-GSP card moved under Options, and the real data folder shown. | Low–Medium | UX-5, UX-17, UX-19, UX-22, UX2-3, PROC2-1 | M | No |
| 10 | **Small hardening batch**: CSV formula guard in ITC-04 / GSTR-9 / IMS; local "today" in the six UTC sites; a 6-digit minimum for new owner PINs; unit tests under `TZ=Asia/Kolkata` in CI; the walk-in not counted as a first customer; wizard landmarks. | Low | SEC-16, COR-4, SEC-13, HEALTH-5, UX2-2, UX2-4 | S | No |

Left out on purpose:
- notarisation: it waits for the Apple Developer ID, which is the owner's;
- HEALTH-3 / HEALTH-6 and COR-5: owner sign-off on figures, already in `to-do.md` §6;
- the e2e-only and dev-only dependency advisories.

---

## 4. Questions for the owner

Plain words; the recommended answer is first. None of these were asked: the owner is away. They are for the owner to answer when back.

| # | Question | Options (recommended first) | Why it matters |
|---|---|---|---|
| Q1 | **Who may sign a release?** Today anyone who can push to the repository can reach the signing key, with or without a tag (SEC2-1). | **(a) Move the key into a protected GitHub "release" environment that only `v*` tags may use: each release waits for your one click in GitHub, and the 12-hour schedule stays (it just pauses for you)** · (b) You sign on your Mac with a key that never goes to GitHub (strongest; every release waits for you) · (c) Keep as is | (a) keeps the schedule and stops a stolen token from taking the key or shipping a signed update to every user, but only if the key moves INTO that environment. (b) is stronger but slower. |
| Q2 | **A debit note's "can't claim GST" mark: follow its purchase, even for notes already saved?** (COR2-1) | **(a) Yes: work it out from the purchase when reading, with a before/after report for your sign-off (only books that used the mark since 13 Nov change)** · (b) Only for new notes, plus a warning when a purchase's mark changes · (c) Leave it | Today GSTR-3B Table 4 can be off by the note's tax after a purchase is re-marked. |
| Q3 | **Which total goes into GSTR-1 and the e-invoice for a bill rounded down?** (COR-3, golden B2B-06) | **(a) The printed (rounded) total, as on the bill, with an upgrade report and a CA check** · (b) Keep the unrounded total | It decides B2CL vs B2CS at the limit, and what the e-invoice says. Filed months could move. |
| Q4 | **Returning an SEZ / export bill made before the 8 Nov fix (#244): should the credit note take back the IGST that bill charged?** (COR2-3) | **(a) Yes, the note follows its bill (ask the CA to confirm)** · (b) No, notes follow today's rule | Otherwise ₹180 on a ₹1,000 bill stays owing after a full return. |
| Q5 | **Tally import: keep a debit note "against" an invoice as part of that invoice, as Tally shows it?** (COR2-4) | **(a) Yes, for imports from now on (already-imported books stay as they are)** · (b) Keep the old work-around | Bill-wise lists and reminders would match Tally. |
| Q6 | **"Remember on this computer" + the screen lock**: should reopening a business after a screen lock ask for the passphrase again? (SEC2-6) | **(a) Yes, once per screen lock** · (b) No, but say in Lock and safety that "remember" lets anyone at this Mac open it | Today switching business and back gets past the lock. |
| Q7 | **Owner PIN length**: ask for at least 6 digits when an owner sets or changes a PIN? (SEC-13) | **(a) Yes, for new / changed PINs (old PINs keep working)** · (b) Keep 4 | 4 digits stay guessable from a copied file. |
| Q8 | **A 58 mm (2-inch) receipt for 1.0?** (PROD-11) | **(a) After 1.0** · (b) Before 1.0 | The commonest cheap shop printer; 80 mm exists. |
