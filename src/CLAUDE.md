# Code quality rules

These rules are for every agent that writes, fixes or reviews code in this repo: feature threads, fix threads, reviewers, Claude or GPT. They cover `src/`, `scripts/` and `site/`. The root `CLAUDE.md` holds the project's conventions (money in paise, audit, migrations, simple mode …); this file says **how** to write a change. A reviewer checks every PR against both, and a breach of either is a finding.

The rules come from what reviews of this repo keep finding: returns that disagree with the books, filed months that move, imports that overwrite later edits, missing tests on the risky path, and docs that claim more than the code does.

## 1. The correct route, not the easy one

- **Fix the root cause.** Find why it breaks before changing code. A guard, a special case or a retry that hides a symptom is not a fix.
- **Never weaken a check to get green.**
  - Don't loosen a lint, an allowlist, a timeout or an assertion.
  - Don't regenerate a fixture, snapshot or hash from the code under test.
  - Don't mark a test `skip` or `it.fails` without a `knownBug` reason.
  - If a check is wrong, fix the check in its own commit and say why in the PR.
- **Read the source before you rely on it.** That means the rule's text (Act, notification, schema), the function you call and the test that pins it. A tax rule is never written from memory. Cite it next to the number. If it can't be confirmed, add it to the UNVERIFIED list with its "Check with your CA" point.
- **Finish the job.** A change is done when every caller, reader and round trip it touches is right: the export / import, undo, both modes, all three languages, prints and returns. Don't leave a "follow-up" for something the change itself breaks. A real follow-up goes in `to-do.md` with its reason. No `TODO` comments in code.
- **Scope.** Do what the work package asks, completely. Make unrelated clean-ups in their own PR.

## 2. Figures

- **One definition per fact.** Before writing a query or a formula, search for the service the accountant screen already uses and call it:
  - profit is `pnlLedgerAmounts`
  - dues are the Outstandings allocation
  - stock is `runInventoryPass`
  - GST is `extractOutwardDocs`

  A second way to compute a figure is a bug, even when it agrees today. If you find one, fold it into the first.
- **The books and the returns agree.** What a document posts is what every report and return reads. If a rule would report a document differently from what it posts, the PR must explain why that is correct and cite the rule.
- **Saved data reads as saved.**
  - A new rule applies to new documents. A document saved before it, and a re-save of one, keep the figures they had.
  - A field that is missing or NULL means the old behaviour, exactly.
  - Any change to a figure in existing books needs the owner's `figures-approved` and a before / after table in the PR.
- **Rules are dated.** Decide by the document's date and the registration, rate or limit in force on that date. Never use today's registration or today's slab for an old bill.
- **Integers only.** Money is in paise and quantities are in thousandths. Use BigInt where a product or a ratio could pass 2^53. Rounding follows the stated rule, with the remainder placed on purpose (for example, largest remainders), never lost.

## 3. Data and writes

- **One transaction per user action.** A refusal leaves no trace: no row, no number used, no audit row. Test it.
- **Every write is audited** (`writeAudit`, `auditCoverage.ts`), with the whole before and after.
- **Imports, undo and round trips** never overwrite what the user changed after them. A source that doesn't carry a field leaves the stored value alone. Test the round trip.
- **Trust boundary.** Every IPC payload is Zod-strict. Main re-reads anything the decision depends on: ids, amounts, the matched line, the open bill. Clamp a caller's `today`; never let it bypass a "not after today" or lock check.
- **SQL.**
  - Filter binned vouchers (`NOT_DELETED`) and stock lines that don't move stock (`MOVES_STOCK`).
  - Give an explicit `ORDER BY` wherever order matters.
  - Never run one query per row; batch lookups in chunks of 500.
  - A check that runs on every save or screen load reads a bounded range, not the whole history.

## 4. Code shape

- **Pure logic lives in `src/shared/`** with unit tests. Services load data, call it and write. Components render and call the client.
- **Reuse before writing.** Search with `rg` for an existing helper, mapping or component, and extend it if needed. Simple flows map through `intents.ts` and the editors' `voucherEdit` mapping, never a second posting path.
- **Small and named for what it does.** A function does one thing. When a name stops being true, rename it.
- **Delete what you replace.** No dead code, commented-out code, unused exports or parameters, or helpers exported from a test file.
- **Types.**
  - No `any` in new or touched code. Some older lines still use it; fix them when you touch them.
  - No `as unknown as` to force a shape. Fix the type instead. It is allowed only at a boundary the compiler can't see, such as a parsed file or a driver row, with a comment saying why.
  - No non-null `!` without a comment saying why it holds.
  - A `switch` over a union ends in a `never` check.
  - Optional fields are added only where "absent" has a defined meaning.
- **Errors.**
  - Throw `AppError` with a code that is mapped in `ERROR_MAP`.
  - A message must be true for every cause that reaches it. For example, a disk error never says "check your internet".
  - Never swallow an error. A `catch` that continues says why in a comment and logs what it drops.
- **Async.**
  - Drop a stale answer: the newest request wins.
  - Disable an action while an answer it depends on is loading.
  - Keep one write request in flight.
  - Mark a deliberate fire-and-forget with `void`.
- **Comments** say why, not what. Keep a doc comment directly above the thing it describes, and update it in the same commit when the behaviour changes.

## 5. UI

- **Simple mode.**
  - Every string goes through `t()`, in en, hi and hinglish, free of the banned words.
  - Dates and amounts go through the formatters with the reader's language.
- **The accountant screens** keep their DOM, keys and snapshots unless the change is meant to alter them, and the PR says so.
- **Show only what the user can do.** Hide or disable actions the role or capability refuses (`useCanSave`, `useCanWrite`).
- **A figure that rests on an UNVERIFIED rule carries its "Check with your CA" point**, on every screen that shows it.
- **Keyboard.**
  - Each key has one handler, so it never fires twice.
  - Enter never creates.
  - Esc closes the top layer only.
- **Accessibility.** Every control has a name and a correct role, and focus moves into a dialog or panel and back out when it closes.
- **Words.** Use plain, short sentences that say what happened and what to do next. Never show a raw code, id or stack to a shop owner.

## 6. Tests

- **Test the risky path.** Cover every branch the change adds, the boundary values, data saved before the change, refusals (no trace), the other side (customer and supplier, sale and purchase), both modes and a viewer.
- **A fix comes with a test that fails on the old code.** Run it there once to be sure.
- **Expected figures are worked by hand,** with the arithmetic in a comment. Never paste them from a run.
- **The right suite.**
  - Pure logic goes in `*.test.ts`, which never imports the SQLite driver.
  - Database code goes in `*.dbtest.ts`.
  - Hooks and components go in `__tests__/`.
  - User flows go in e2e.
- **No sleeps and no retries.** Wait on a state (`data-loading`, a row, `until(fn)`). Dates are local (`localToday()`), never `toISOString()` for today.
- **Before asking for review**, run `npm run typecheck`, `npm run lint`, and the suites the change touches, all green. Run the e2e scenarios for any changed flow against a fresh `npm run build`.

## 7. Docs and claims

- **Say exactly what the code does.** The PR description, `CLAUDE.md`, `docs/` and comments must not overclaim ("all", "never", "fixed") anything the code or tests don't show. Mark something read but not run as "not run".
- **A convention you add or change** updates its `CLAUDE.md` bullet in the same PR. Add a `CHANGELOG.md` "Unreleased" entry with the PR link for anything a user notices.
- **Owner-facing text** uses plain words and short sentences, with the recommended option first.

## 8. Before you say done

Check each of these:

- [ ] Root cause found and fixed, and no check weakened.
- [ ] Old books read exactly as before, or the figure change has the owner's approval and a before / after table.
- [ ] One definition for each figure touched.
- [ ] Refusals leave no trace. Imports, undo and round trips keep later edits.
- [ ] Tests cover every new branch, and the fix's test failed before it.
- [ ] Typecheck, lint and the touched suites pass locally.
- [ ] No dead code, debug output, `TODO`, stray `any`, or swallowed error.
- [ ] Docs, `CLAUDE.md` and CHANGELOG say exactly what changed.
- [ ] You re-read the whole diff as the reviewer would.
