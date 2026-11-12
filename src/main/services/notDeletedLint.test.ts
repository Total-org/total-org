// Pure lint (plain-Node vitest — reads source text, never imports a service; audit A11 / HEALTH-5):
// every SQL string in src/main/services, src/main/ai, src/main/assist, src/main/gstGateway and the
// src/main/*.ts IPC files that READS `vouchers` / `voucher_lines` must leave binned vouchers out —
// interpolate ${NOT_DELETED} / ${IN_BOOKS} (or a local constant built on them), or say
// `deleted_at IS NULL` — or sit on the allowlist below (one entry = one string) with
// the reason it may see the bin. CLAUDE.md: "every new SQL query touching vouchers / voucher_lines
// must filter deleted_at IS NULL unless it's explicitly reading the bin, getVoucher, or
// nextVoucherNumber". A new report that forgets it counts binned bills silently — this test is
// what catches it.
//
// Not scanned as readers (decided by the string itself, no allowlist entry needed):
//   - writes: a statement that starts with INSERT / UPDATE / DELETE / CREATE / DROP;
//   - by-id lookups: the voucher (or its lines) is pinned to a VOUCHER id the caller already holds —
//     `id = ?` / `v.id = ?` / `voucher_id = ?` / `… IN (${ids})` — the caller chose it, so the
//     bin is its business (getVoucher, a save's own lines, a match's voucher …).
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { sqlStrings } from './sqlStrings.testutil'

const MAIN = join(__dirname, '..')
const DIRS = ['services', 'ai', 'assist', 'gstGateway']

/** `file` (relative to src/main) + a substring unique to the SQL string → why it may see binned vouchers. */
const ALLOW: { file: string; contains: string; reason: string }[] = [
  { file: 'services/assistants.ts', contains: 'vt.kind <> \'physical_stock\' AND (SELECT COALESCE(SUM(CASE WHEN dr_cr = \'dr\' THEN amount ELSE -amount END), 0) FROM voucher_lines WHERE voucher_id = v.id) <> 0', reason: 'a WHERE fragment for monthVouchers, whose query already has IN_BOOKS' },
  { file: 'services/assistants.ts', contains: 'a.entity = \'tally_import\'', reason: 'the ids of Tally-imported vouchers, a skip set for the back-dated check (the anomaly rows themselves are IN_BOOKS)' },
  { file: 'services/audit.ts', contains: 'SELECT id FROM vouchers WHERE is_year_end_close = 1', reason: 'every closing journal there is or was, binned too (edit-log redaction, review of #238)' },
  { file: 'services/cheques.ts', contains: 'SELECT DISTINCT number FROM vouchers', reason: 'a reference that is ANY voucher\'s number (binned too) never counts as a cheque number' },
  { file: 'services/dataImport.ts', contains: 'SELECT 1 FROM vouchers LIMIT 1', reason: 'does the company have any voucher at all (binned too) — then its first year is left as it is' },
  { file: 'services/dataImport.ts', contains: 'SELECT 1 FROM vouchers WHERE voucher_type_id = ?', reason: 'import undo: a voucher type any voucher (binned too) still uses is not deleted' },
  { file: 'services/edocs.ts', contains: 'SELECT DISTINCT sv.number, sv.ewb_no AS ewbNo', reason: 'the challans a live invoice draws on — a challan with live links can\'t be binned (tradeLinks: "bin that first")' },
  { file: 'services/featureUsage.ts', contains: 'WHERE t.kind IN (\'delivery_note\', \'receipt_note\')', reason: 'hidden-until-used: a feature is used when it has ANY row, binned included' },
  { file: 'services/featureUsage.ts', contains: 'SELECT COALESCE(MAX(id), 0) AS m FROM vouchers', reason: 'hidden-until-used: the high-water mark of the incremental voucher scan' },
  { file: 'services/featureUsage.ts', contains: 'SELECT EXISTS (SELECT 1 FROM vouchers WHERE id > ? AND id <= ?', reason: 'hidden-until-used: a feature is used when it has ANY row, binned included' },
  { file: 'services/gst.ts', contains: 'SELECT DISTINCT v.voucher_type_id AS typeId, vt.kind', reason: 'GSTR-1 Table 13: a binned voucher used a number and is reported as cancelled (extractDocSeries)' },
  { file: 'services/masters.ts', contains: 'SELECT COUNT(*) AS n FROM voucher_lines WHERE ledger_id = ?', reason: 'delete guard: a binned voucher still points at the ledger' },
  { file: 'services/reports.ts', contains: 'COALESCE((SELECT SUM(amount) FROM voucher_lines WHERE voucher_id = v.id AND dr_cr = \'dr\'), 0) AS total', reason: 'baseVoucherSql, a SELECT fragment — every query built on it adds IN_BOOKS / NOT_DELETED' },
  { file: 'services/search.ts', contains: 'SELECT voucher_id FROM voucher_lines WHERE amount BETWEEN ? AND ?', reason: 'a WHERE term — every search query also has NOT_DELETED (w.add(NOT_DELETED))' },
  { file: 'services/search.ts', contains: 'v.id IN (SELECT voucher_id FROM voucher_lines WHERE ledger_id IN (${lit}))', reason: 'a WHERE term — every search query also has NOT_DELETED (w.add(NOT_DELETED))' },
  { file: 'services/search.ts', contains: 'SELECT MAX(id) AS n FROM vouchers', reason: 'the size estimate for the Driving cap (counts only)' },
  { file: 'services/search.ts', contains: 'SELECT 1 FROM voucher_lines WHERE ledger_id IN (${lit})', reason: 'Driving: a bounded count to choose the query plan, never a result' },
  { file: 'services/search.ts', contains: 'SELECT 1 FROM vouchers WHERE party_ledger_id IN (${lit})', reason: 'Driving: a bounded count to choose the query plan, never a result' },
  { file: 'services/search.ts', contains: 'SELECT v.id, COUNT(*) OVER () AS total FROM vouchers v', reason: 'w.sql() always holds NOT_DELETED (w.add(NOT_DELETED))' },
  { file: 'services/search.ts', contains: 'SELECT COUNT(*) AS n FROM vouchers v WHERE ${w.sql()}', reason: 'w.sql() always holds NOT_DELETED (w.add(NOT_DELETED))' },
  { file: 'services/search.ts', contains: 'v.reference, v.is_optional AS isOptional, v.post_dated AS postDated', reason: 'the page\'s own ids (WHERE v.id IN json), found by the filtered query' },
  { file: 'services/search.ts', contains: 'l.group_id AS groupId, l.hsn', reason: 'the page\'s own ids (WHERE vl.voucher_id IN json), found by the filtered query' },
  { file: 'services/serials.ts', contains: 'sn.serial, sn.status', reason: 'labels rows of the serial projection, which rebuildItemSerials builds from live movements only' },
  { file: 'services/simpleMoney.ts', contains: 'v.instrument_no AS instrument', reason: 'HEAD_SQL, a SELECT fragment — both queries built on it add IN_BOOKS' },
  { file: 'services/tallyImport.ts', contains: 'SELECT 1 FROM vouchers LIMIT 1', reason: 'does the company have any voucher at all (binned too) — then its first year is left as it is' },
  { file: 'services/tallyImport.ts', contains: 'SELECT 1 FROM vouchers WHERE voucher_type_id = ? LIMIT 1', reason: 'a voucher type any voucher (binned too) uses keeps its kind' },
  { file: 'services/tcsEvents.ts', contains: 'AND v.id IN (SELECT voucher_id FROM voucher_lines WHERE ledger_id = ?)', reason: 'partyClause, appended to loadTcsVouchers\' query, which has IN_BOOKS' },
  { file: 'services/tdsEvents.ts', contains: 'AND v.id IN (SELECT voucher_id FROM voucher_lines WHERE ledger_id = ?)', reason: 'partyClause, appended to loadTdsVouchers\' query, which has IN_BOOKS' },
  { file: 'services/tradeAnalysis.ts', contains: 'NULL AS tradeDocId, v.number, v.date', reason: 'VOUCHER_FACTS, a SELECT fragment — the loaders add LIVE_VOUCHER; grnByUid reads the GRN line a live bill links to' },
  { file: 'services/vouchers.ts', contains: 'SELECT MAX(id) AS id FROM vouchers', reason: 'recentParties: the top of the id window; the rows read under it filter NOT_DELETED' },
  { file: 'services/gst.ts', contains: 'SELECT v.number, v.deleted_at AS deletedAt', reason: 'GSTR-1 Table 13: each series\' numbers, binned ones counted as cancelled (extractDocSeries)' },
  { file: 'services/gst.ts', contains: 'COALESCE(tvd.purpose, \'supply\') AS purpose', reason: 'GSTR-1 Table 13: the delivery-challan series, binned challans counted as cancelled (challanDocSeries)' },
  { file: 'services/gstRcm.ts', contains: 'v.pos_override AS posOverride, v.deleted_at AS deletedAt', reason: 'HEAD_SQL, a SELECT fragment — the range reader adds IN_BOOKS (or a stored self-invoice); the others are by id and show a binned bill as binned' },
  { file: 'services/tradeLinks.ts', contains: 'v.date, v.deleted_at AS deletedAt, v.is_optional AS isOptional', reason: 'VOUCHER_LINE_SQL: link rules I1–I7 read binned lines too (binned flag) — a binned target still holds its links' },
  { file: 'services/vouchers.ts', contains: 'v.deleted_at IS NOT NULL AND v.deleted_at <= datetime(\'now\', ?)', reason: 'purgeOldDeleted: reads the bin to empty it' },
  { file: 'services/vouchers.ts', contains: 'v.deleted_at AS deletedAt,\n', reason: 'listBin: the bin itself' }
]

const READS = /\b(?:FROM|JOIN)\s+(?:vouchers|voucher_lines)\b/i
/** A real predicate — the shared constants interpolated, or `deleted_at IS NULL` written out. A
 *  `deleted_at` column in a SELECT or `deleted_at IS NOT NULL` (a bin reader) is not a filter. */
const FILTERED = /\$\{\s*(?:NOT_DELETED|IN_BOOKS)\s*\}|deleted_at\s+IS\s+NULL/i
/** In code (not SQL text): a constant's initialiser that names the shared filters. */
const FILTER_IN_CODE = /\b(?:NOT_DELETED|IN_BOOKS)\b|deleted_at\s+IS\s+NULL/i
const WRITE = /^[`'"]\s*(?:INSERT|UPDATE|DELETE|CREATE|DROP|REPLACE)\b/i

/** Names in a source file bound to a filter (`const LIVE_VOUCHER = 'v.deleted_at IS NULL …'`,
 *  `const scope = all ? NOT_DELETED : IN_BOOKS`, `const conds = [NOT_DELETED]`): a SQL string that
 *  interpolates one (`${scope}`, `${conds.join(' AND ')}`) is filtered too. A const that RUNS a
 *  query (`db.prepare(…)`) holds a result, not a filter. */
function filterNames(src: string): string[] {
  const out: string[] = []
  for (const m of src.matchAll(/\b(?:const|let)\s+(\w+)\s*(?::[^=]+)?=([^;\n]{0,300})/g)) {
    const init = m[2]!
    if (FILTER_IN_CODE.test(init) && !/\.prepare\(|\.get\(|\.all\(/.test(init)) out.push(m[1]!)
  }
  return out
}

/** Is the string pinned to vouchers / voucher lines the caller already holds? Only a VOUCHER id
 *  counts — `voucher_id = ?` / `… IN (${ids})` on any alias, or `id` on an alias the string
 *  declares for vouchers / voucher_lines (bare `id` when one of them is unaliased); a ledger's,
 *  item's or party's id pins nothing, and `? IS NULL OR v.id = ?` is optional, not a pin. */
function pinnedById(s: string): boolean {
  const t = s.replace(/\?\s+IS\s+NULL\s+OR\s+[\w.]+\s*=\s*\?/gi, '')
  const pin = String.raw`\s*(?:=\s*\?|IN\s*\(\s*\$\{)`
  if (new RegExp(String.raw`\bvoucher_id` + pin, 'i').test(t)) return true
  const aliases: string[] = []
  let bare = false
  for (const m of t.matchAll(/\b(?:FROM|JOIN)\s+(?:vouchers|voucher_lines)\b(?:\s+(?:AS\s+)?(\w+))?/gi)) {
    const a = m[1]
    if (!a || /^(?:WHERE|JOIN|LEFT|INNER|CROSS|ON|ORDER|GROUP|LIMIT|USING)$/i.test(a)) bare = true
    else aliases.push(a)
  }
  for (const a of aliases) if (new RegExp(String.raw`\b${a}\.id` + pin, 'i').test(t)) return true
  return bare && new RegExp(String.raw`(?<![.\w])id` + pin, 'i').test(t)
}

/** Is this SQL string a reader that needs the filter? `names` = the file's filterNames. */
function needsFilter(s: string, names: string[] = []): boolean {
  if (!READS.test(s) || FILTERED.test(s) || WRITE.test(s)) return false
  if (names.some((n) => s.includes('${' + n + '}') || s.includes('${' + n + '.'))) return false
  return !pinnedById(s)
}

const isSource = (f: string): boolean => f.endsWith('.ts') && !/\.(test|dbtest)\.ts$/.test(f) && !f.endsWith('.testutil.ts')
const files = [
  ...readdirSync(MAIN).filter(isSource),
  ...DIRS.flatMap((d) => (readdirSync(join(MAIN, d), { recursive: true }) as string[]).filter(isSource).map((f) => `${d}/${f.split('\\').join('/')}`))
]

describe('NOT_DELETED lint', () => {
  it('tells readers from writes, by-id lookups and filtered queries', () => {
    expect(needsFilter('`SELECT SUM(amount) FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id WHERE v.date <= ?`')).toBe(true)
    expect(needsFilter('`SELECT 1 FROM vouchers v WHERE ${NOT_DELETED} AND v.date <= ?`')).toBe(false)
    expect(needsFilter('`SELECT 1 FROM vouchers v WHERE ${IN_BOOKS}`')).toBe(false)
    expect(needsFilter("'SELECT * FROM vouchers WHERE id = ?'")).toBe(false)
    expect(needsFilter('`SELECT * FROM voucher_lines WHERE voucher_id IN (${marks})`')).toBe(false)
    expect(needsFilter("'DELETE FROM voucher_lines WHERE voucher_id = ?'")).toBe(false)
    expect(needsFilter("'UPDATE vouchers SET deleted_at = NULL WHERE id = ?'")).toBe(false)
    expect(needsFilter("'SELECT voucher_id FROM voucher_lines WHERE voucher_id = v.id'")).toBe(true)
    expect(needsFilter("'SELECT * FROM voucher_types'")).toBe(false)
    expect(needsFilter("'SELECT * FROM undo_group_vouchers'")).toBe(false)
    // Review of #254: a ledger / item / party id pins nothing; an optional id is no pin; a
    // deleted_at COLUMN is no filter, nor is a const holding one.
    expect(needsFilter('`SELECT 1 FROM voucher_lines vl JOIN vouchers v ON v.id = vl.voucher_id JOIN ledgers l ON l.id = vl.ledger_id WHERE l.id = ? AND v.date <= ?`')).toBe(true)
    expect(needsFilter('`SELECT 1 FROM inventory_lines il JOIN vouchers v ON v.id = il.voucher_id JOIN stock_items si ON si.id = il.stock_item_id WHERE si.id = ? AND v.date <= ?`')).toBe(true)
    expect(needsFilter('`SELECT 1 FROM vouchers v JOIN ledgers p ON p.id = v.party_ledger_id WHERE p.id = ?`')).toBe(true)
    expect(needsFilter('`SELECT 1 FROM vouchers v WHERE v.date BETWEEN ? AND ? AND (? IS NULL OR v.id = ?)`')).toBe(true)
    expect(needsFilter('`SELECT v.id, v.deleted_at AS deletedAt FROM vouchers v WHERE v.date BETWEEN ? AND ?`')).toBe(true)
    expect(needsFilter("`SELECT 1 FROM vouchers v WHERE v.deleted_at IS NOT NULL`")).toBe(true)
    expect(needsFilter('`SELECT 1 FROM vouchers v WHERE v.deleted_at IS NULL AND v.date <= ?`')).toBe(false)
    expect(needsFilter('`SELECT * FROM vouchers v WHERE v.id = ?`')).toBe(false)
    expect(needsFilter('`SELECT * FROM voucher_lines vl WHERE vl.voucher_id = ?`')).toBe(false)
    expect(needsFilter("`SELECT 1 FROM vouchers v WHERE ${HEAD} AND v.date <= ?`", filterNames("const HEAD = 'SELECT v.deleted_at AS deletedAt FROM vouchers v'"))).toBe(true)
    expect(filterNames("const row = db.prepare('SELECT 1 FROM vouchers v WHERE v.deleted_at IS NULL').get()")).toEqual([])
    const names = filterNames("const LIVE = 'v.deleted_at IS NULL AND v.is_optional = 0'\nconst conds = [NOT_DELETED]\nconst OTHER = 'v.date <= ?'")
    expect(names).toEqual(['LIVE', 'conds'])
    expect(needsFilter('`SELECT 1 FROM vouchers v WHERE ${LIVE}`', names)).toBe(false)
    expect(needsFilter("`SELECT 1 FROM vouchers v WHERE ${conds.join(' AND ')}`", names)).toBe(false)
    expect(needsFilter('`SELECT 1 FROM vouchers v WHERE ${OTHER}`', names)).toBe(true)
  })

  it('every vouchers / voucher_lines reader filters the bin or is allowlisted with a reason', () => {
    const offenders: string[] = []
    const uses = new Map<number, number>()
    for (const f of files) {
      const src = readFileSync(join(MAIN, f), 'utf8')
      const names = filterNames(src)
      for (const s of sqlStrings(src)) {
        if (!needsFilter(s, names)) continue
        const k = ALLOW.findIndex((a) => a.file === f && s.includes(a.contains))
        if (k === -1) offenders.push(`${f}: ${s.slice(0, 200).replace(/\s+/g, ' ')}`)
        else uses.set(k, (uses.get(k) ?? 0) + 1)
      }
    }
    expect(offenders, 'a vouchers reader without NOT_DELETED / IN_BOOKS — add the filter, or allowlist it with a reason').toEqual([])
    // Stale entries hide nothing but mislead; an entry covers exactly ONE string, so a second,
    // new reader that happens to share its text is not waved through.
    expect(ALLOW.filter((_a, k) => !uses.has(k)).map((a) => `${a.file}: ${a.contains}`)).toEqual([])
    expect(ALLOW.filter((_a, k) => (uses.get(k) ?? 0) > 1).map((a) => `${a.file}: ${a.contains}`)).toEqual([])
  })
})
