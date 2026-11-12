# Architecture

One page on how Total is built. The rules in full (and why each exists) are in
[CLAUDE.md](../CLAUDE.md); this page is the map.

## Shape

Total is an Electron desktop app: React + TypeScript + Tailwind in the renderer, Node in main,
SQLite (`better-sqlite3-multiple-ciphers`) for storage. It is fully offline; the only network
calls are the optional AI service, the optional NIC / GST gateway clients and the update check —
all from main, never from the renderer.

```
renderer (React)  ──window.total.invoke(channel, payload)──▶  preload (contextBridge)
                                                                   │
main: ipc.ts handle() ─ sender check · role / capability gate · Zod parse · { ok, data | error }
        │
        ├─ services/*      the business operations (one transaction per write, audited)
        ├─ db/*            open / migrate / encrypt / back up / verify company files
        ├─ ai/*            the only code that talks to an AI service
        └─ assist/*        Ask Total: deterministic answers, no network
                                │
src/shared/*  pure TypeScript engine — money, dates, GST, posting rules, valuation, returns,
              intents, i18n. No Electron, no DB; where the unit tests live.
```

| Folder | Holds |
|---|---|
| `src/shared/` | The engine: `money.ts` (integer paise), `dates.ts`, `gst/` (rates, returns, e-invoice), `posting.ts`, `valuation.ts`, `outstanding.ts`, `voucherEdit/` (editor ↔ voucher mapping), `simple/` (intents, plain sentences), `i18n/` |
| `src/main/` | Electron main: `db/` (connection, migrations, encryption, backups), `services/`, `ipc<Area>.ts` per area, `ai/`, `assist/`, `perf/`, updater |
| `src/preload/` | `window.total.invoke` only |
| `src/renderer/src/` | Screens, the component kit (`components/kit/`), `DataTable`, simple-mode screens (`simple/`), help articles (`help/`) |
| `site/` | The marketing site (Next.js on Vercel), separate build |
| `scripts/` | CLI, e2e scenarios (Playwright `_electron`), release gate |

## Data

- **One SQLite file per business**, `Documents/total/companies/<slug>/company.db`, with its
  backups, attachments and captured bills beside it. `total.json` lists the businesses.
- **Money is integer paise; quantities are integer thousandths.** Floats never touch an amount.
- **Voucher lines are the truth.** Every report (trial balance, P&L, Outstandings, stock value, GST
  returns) is computed from `voucher_lines` + opening balances when asked. Nothing is
  denormalised; there is one definition of profit (`pnlLedgerAmounts`) and one stock valuation pass
  (`runInventoryPass`).
- **Soft delete**: binned vouchers carry `deleted_at`; every reader filters them (a lint enforces it).
- **Edit log**: every write goes through `writeAudit` with the whole before / after, into an
  append-only, hash-chained `audit_log` (MCA rule 3(1)).
- **Migrations** are appended to `db/migrations.ts`, never edited; opening an old file migrates it.
  Saved facts that a later rule would change are kept (tax-fact snapshots, legacy rounding flags),
  so **figures in existing books never move silently**.

## Writes

- Every IPC payload is Zod-parsed; every write channel is mapped in `auditCoverage.ts`; errors are
  `AppError(code, …)` mapped to a field and a plain message (`shared/errors/`).
- The full app's editors save through `voucher:save` → `saveVoucher` (posting rules, lock date,
  credit hold, GST registration rule, stock rules).
- **Simple mode adds no posting path**: a simple screen builds an *intent* (sale, purchase, money
  in / out, return, stock count …), `mapIntent` turns it into the editors' own form state, and
  `simple:post` saves it through the same `saveVoucher` in one transaction (idempotent by
  `clientId`, undo as one group). `simple:preview` rehearses the same run and rolls it back.
- AI drafts and Ask Total offers are stored as drafts; a person saves them through the same paths.

## Two modes, three languages

- Company meta `ui.mode` chooses simple or full (missing = full, so old books open unchanged). Each
  screen declares its modes in `lib/screens.ts`; "Accountant view" / "Back to simple" hand the same
  object between them (`shared/simple/handoff.ts`).
- Simple-mode text goes through `t()` (`shared/i18n/`): English complete, Hindi and Hinglish
  complete for simple screens (machine-drafted, labelled beta); a lint bans accounting jargon there.

## Security

- Optional passphrase lock per business: the DB (SQLCipher scheme) and its attachments are
  encrypted at rest; the key is wrapped with scrypt + AES-GCM and never stored in clear.
- Sign-ins with roles (owner / accountant / viewer) and capability flags; idle lock.
- Secrets (AI keys, NIC credentials) are encrypted with the OS keychain (`safeStorage`) in
  `Documents/total/secrets.json`, never in a company file or backup. Packaged builds: sandboxed renderer, strict CSP, no dev tools, Electron fuses.
- Updates are offered only when a signed release manifest verifies (Ed25519).

## Quality gates

| Gate | What |
|---|---|
| `npm test` | Pure engine tests (hand-worked figures; GST golden bills validated against the official schemas) |
| `npm run test:db` | Services against real SQLite under Electron-as-Node |
| `npm run test:renderer` | Components and hooks (jsdom) |
| `npm run e2e` | Playwright scenarios on the built app |
| `npm run perf` | Budgets on a 100k-entry seed |
| CI | All of the above on Linux / macOS / Windows |
| Scheduled release | Every 12 h: green CI + the upgrade test (the last release's books opened by HEAD, every report identical) |
| Upgrade matrix | The same upgrade test from 0.10.0 onwards, on demand (Phase 6) |
