# Code quality rules

These rules are for every agent that writes, fixes or reviews code in this repo: feature threads, fix threads, reviewers, Claude or GPT. They cover `src/`, `scripts/` and `site/`. Claude loads this file automatically only for files under `src/`; for `scripts/` and `site/` it is reached through the pointer in the root `CLAUDE.md` and `AGENTS.md`.

The root `CLAUDE.md` holds the project's conventions (money in paise, audit, migrations, simple mode …). This file says **how** to write a change. Every PR is reviewed against both, and a breach of either is a finding.

The rules come from what the reviews of PRs #254–#283 kept finding: returns that disagree with the books, filed months that move, imports that overwrite later edits, warnings that fire on every save, guards that let the bad case through, risky paths left untested, and docs that claim more than the code does.

## 1. The correct route, not the easy one

- **Fix the root cause.** Find out why it breaks before changing code. A guard, a special case or a retry that hides a symptom is not a fix.
- **Never weaken a check to get green.**
  - Don't loosen a lint or an assertion, and don't raise a timeout.
  - Don't regenerate a fixture, snapshot or hash from the code under test.
  - Never skip a test to get green. `it.fails` is only for a golden fixture's `knownBug`. A conditional skip (`skipIf` / `runIf` on the platform or an env switch) is allowed, and its condition says why.
  - Add an allowlist entry only where the root `CLAUDE.md` allows one: one entry per string, with its reason. Never widen a pattern.
  - Fix the code rather than add an `eslint-disable` when the fix is a line.
  - If a check itself is wrong, fix it in its own commit and say why in the PR.
- **A guard is shown to catch what it guards.** A new lint, test guard or CI gate comes with a case it must reject, and you see it fail once.
- **Read the source before you rely on it**: the rule's text (Act, notification, schema), the function you call, and the test that pins it.
  - A tax rule is never written from memory. Cite it next to the number.
  - If it can't be confirmed, add it to the UNVERIFIED list with its "Check with your CA" point.
- **Finish the job.** A change is done when every caller, reader and round trip it touches is right: export and import, undo, both modes, all three languages, prints and returns.
  - Don't leave a "follow-up" for something the change itself breaks.
  - A real follow-up goes in `to-do.md` with its reason. No `TODO` comments in code.
- **Scope.** Do what the work package asks, completely. Unrelated clean-ups go in their own PR.

## 2. Figures

- **One definition per fact.** Before writing a query or a formula, find the service the accountant screen already uses and call it:
  - profit: `pnlLedgerAmounts`
  - dues: `outstandingsWithAdvances` / `partyAllocation`
  - stock: `runInventoryPass`
  - GST on sales: `extractOutwardDocs`
  - GST on purchases: `extractPurchaseDocs`, `bookedItcByVoucher`, `itcBreakdown`

  A second way to compute a figure is a bug, even when it agrees today. If you find one, fold it into the first.
- **The books and the returns agree.** What a document posts is what every report and return reads. If a rule reports a document differently from what it posts, the PR explains why and cites the rule.
- **Saved data keeps its figures.**
  - By default a new rule applies to new documents.
  - A document saved before the rule keeps its figures when it is re-saved unchanged. An edit to a line, date, party, account, place of supply or currency may bring the new rule, as `legacyGroupTax` does.
  - A missing or NULL field means the old behaviour, exactly.
  - Only the owner can apply a rule to old documents. That needs the `figures-approved` label and a before / after table in the PR.
- **Rules are dated.** Decide by the document's date and by the registration, rate or limit in force on that date. Never use today's registration or today's slab for an old bill.
- **Integers only.** Money is in paise and quantities in thousandths. Use BigInt where a product or a ratio could pass 2^53. Rounding follows the stated rule and places the remainder on purpose (for example, largest remainders), never losing it.

## 3. Data and writes

- **One transaction per user action.** A refusal leaves no trace: no row, no used number, no audit row. Test it.
- **Every write is audited** (`writeAudit`, mapped in `auditCoverage.ts`) with the whole before and after.
- **Locked and closed periods.** Any new write that can change a figure checks the lock date (`getLockDate`, refused as `books_locked`, as `saveVoucher` does) and closed years (`fyIsClosed`, as `simple:post`'s `simple_year_closed`). Test both.
- **Profit privacy.** A new channel, AI tool or Ask Total answer that returns profit, or sale value minus cost, goes through `canSeeProfit` (`PROFIT_CHANNELS` in `src/main/capabilities.ts`, `ai/tools/profitGuard.ts`). Test it with a user whose flag is false.
- **Imports, undo and round trips** never overwrite what the user changed after them. A source that doesn't carry a field leaves the stored value alone. Test the round trip.
- **Inputs.**
  - Check every input's range on both sides; a date gets a lower bound as well as "not after today".
  - Check a value from an import like a typed one, or skip it with a warning.
- **Trust boundary.**
  - A new IPC payload's schema is strict (`.strict()`).
  - Main re-reads anything the decision depends on: ids, amounts, the matched line, the open bill.
  - Clamp a caller's `today` with `homeAsOn(asked, todayISO())`. It must never bypass a "not after today" or lock check.
- **SQL.**
  - Filter binned vouchers (`NOT_DELETED`) and lines that don't move stock (`MOVES_STOCK`).
  - Use an explicit `ORDER BY` wherever order matters.
  - Never run one query per row; batch lookups in chunks of 500.
  - A check that runs on every save or screen load reads a bounded range, not the whole history.

## 4. Code shape

- **Where code goes.** Pure logic lives in `src/shared/` with unit tests. Services load data, call it and write. Components render and call the client.
- **Reuse before writing.** Search with `rg` for an existing helper, mapping or component, and extend it if needed. Simple flows map through `intents.ts` and the editors' `voucherEdit` mapping, never a second posting path.
- **Small, and named for what it does.** A function does one thing. When a name stops being true, rename it.
- **Delete what you replace.** No dead code, commented-out code, unused exports or parameters, and no helpers exported from a test file.
- **Types, in new or touched code.** Some older lines break these rules; fix them when you touch them.
  - No `any`.
  - No non-null `!` without a comment saying why it holds.
  - No `as unknown as` to force a shape; fix the type instead. It is allowed only at a boundary the compiler can't see, such as a parsed file or a driver row, with a comment saying why.
  - A `switch` over a union ends with `default: { const _exhaustive: never = x; throw new Error(...) }`.
  - Add an optional field only where "absent" has a defined meaning.
- **Errors.**
  - Throw `AppError` with a code mapped in `ERROR_MAP`. A file that throws a new code goes on `errorMapping.test.ts`'s list of scanned files.
  - A message is true for every cause that reaches it. A disk error never says "check your internet".
  - Never swallow an error. A `catch` that carries on says why in a comment. In main it logs what it drops with `log(level, event, data)` from `src/main/log.ts`. Code in `src/shared/` can't log, so it returns the problem to its caller.
- **Async.**
  - Drop a stale answer: the newest request wins.
  - Disable an action while an answer it depends on is loading.
  - Keep one write request in flight.
  - Mark a deliberate fire-and-forget with `void`.
- **Comments** say why, not what. A doc comment sits directly above the thing it describes and is updated in the same commit when the behaviour changes.

## 5. UI

- **Simple mode.**
  - Every string goes through `t()` in en, hi and hinglish, free of the banned words.
  - Dates and amounts go through the formatters with the reader's language.
- **The accountant screens** keep their DOM, keys and snapshots unless the change is meant to alter them, and the PR says so.
- **Only what the user can do.** Hide or disable actions the role or capability refuses (`useCanSave`, `useCanWrite`).
- **"Check with your CA".** A figure that rests on an UNVERIFIED rule carries its CA point on every screen that shows it.
- **Warnings.**
  - A warning fires only when its condition holds, never on every save.
  - Its advice is checked like code: following it must not move a filed month or contradict the app's own rule.
  - When the user must act on it, show it where it stays (a banner or a note), not only in a timed toast.
- **Keyboard.**
  - A key press runs one action. Esc and ⌘↵ go through the existing routers in `kit/layers.ts`. A field that handles them itself is marked `data-consumes-escape` / `data-own-save-key`.
  - In a picker, Enter picks the highlighted match. Only the Create row, reached with ↓, creates.
- **Accessibility.** Every control has a name and the right role. Focus moves into a dialog or panel and back out when it closes.
- **Words.** Use plain, short sentences that say what happened and what to do next. Never show a shop owner a raw code, id or stack.

## 6. Tests

- **Test the risky path.** Cover every branch the change adds, boundary values, data saved before the change, refusals (no trace), the other side (customer and supplier, sale and purchase), both modes, and a viewer.
- **A fix comes with a test that fails on the old code.** Run it there once to be sure.
- **Where expected figures come from.** Work them out by hand, with the arithmetic in a comment, and never make them by running the code under test. A parity fixture (hash, snapshot, `__fixtures__`) is made only from origin/main or the pre-change code, with its documented switch.
- **The right suite.**
  - `npm test`: pure `src/shared` / `src/main` / `src/preload` `*.test.ts` (never imports the SQLite driver) and `scripts/release`, `scripts/lib`.
  - `npm run test:db`: `*.dbtest.ts`.
  - `npm run test:renderer`: every test under `src/renderer` (`__tests__/` and files like `help/articles.test.ts`).
  - `npm run e2e` (or `node scripts/run-e2e.mjs NN`): user flows, run against a fresh `npm run build`.
  - `site/`: `cd site && npm test && npm run build`.
- **Dates.** App code takes today from `todayISO()` and does day arithmetic with `addDaysISO` / `daysBetweenISO` (`dates.ts`). e2e scenarios use `localToday()`. Never `toISOString()` for today.
- **No sleeps and no retries.** Wait on a state (`data-loading`, a row, `until(fn)`). A check that something did NOT happen first waits for what would make it happen: `h.ipcDrained()`, `h.frames()`, or the data it depends on being loaded.
- **Before asking for review**, run `npm run typecheck`, `npm run lint` and every suite the change touches, all green. `lint` and `typecheck` don't cover `scripts/` or `site/`; run those parts' own tests.

## 7. Docs and claims

- **Say exactly what the code does.** The PR description, `CLAUDE.md`, `docs/` and comments never overclaim ("all", "never", "fixed") beyond what the code or the tests show. Something read but not run is marked "not run".
- **Conventions.** A convention you add or change updates its `CLAUDE.md` bullet in the same PR.
- **CHANGELOG.** Anything a user notices gets a `CHANGELOG.md` "Unreleased" entry with the PR link.
- **Owner-facing text** uses plain words and short sentences, with the recommended option first.

## 8. Before you say done

Check each of these:

- [ ] The root cause is found and fixed, no check is weakened, and any new guard was seen to fail.
- [ ] Old books read exactly as before, or the figure change has the owner's approval and a before / after table.
- [ ] Each figure touched has one definition.
- [ ] Locked and closed periods, profit privacy and input ranges are respected.
- [ ] A refusal leaves no trace, and imports, undo and round trips keep later edits.
- [ ] Every new branch has a test, and the fix's test failed before the fix.
- [ ] Typecheck, lint and every touched suite pass locally.
- [ ] No dead code, debug output, `TODO`, stray `any`, or swallowed error is left.
- [ ] Docs, `CLAUDE.md` and CHANGELOG say exactly what changed.
- [ ] You re-read the whole diff as the reviewer would.
