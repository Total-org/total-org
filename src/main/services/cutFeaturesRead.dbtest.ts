// A13b — old books still read exactly as before. `__fixtures__/cutFeatures/book.db.gz` is the demo
// company plus an interest debit note, two fixed assets (depreciation runs, one sold with GST under
// s.18(6)) and two PF / ESI / PT pay runs with a PF payment — all made through the services that
// existed before the cut (cutFeaturesGen.dbtest.ts.txt, run on origin/main at b2b77886 — re-run there with the extended suite after the review of #243). The
// hashes in `hashes.json` were written by THAT code; this test opens the same file with the
// current code (migrating it as the app does on launch) and must reproduce every one. Never
// regenerate them to pass.
import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { gunzipSync } from 'zlib'
import { join } from 'path'
import { tmpdir } from 'os'

vi.mock('./pdf', () => ({ htmlToPdf: async (html: string) => Buffer.from(`%PDF-test ${html.length}`), writeExportPdf: async () => '/dev/null' }))

import { testFileDb } from '../db/testdb'
import { migrate } from '../db/migrate'
import { readCompanyInfo } from '../db/seed'
import { canonical, hashOf } from '../perf/reportSuite'
import { cutFeatureOutputs, CUT_TODAY, NO_PF_ESI, withoutPfEsiDeadlines } from './cutFeaturesSuite'

const DIR = join(__dirname, '__fixtures__', 'cutFeatures')
const expected = JSON.parse(readFileSync(join(DIR, 'hashes.json'), 'utf8')) as Record<string, string>

describe('A13b: a book that used interest, fixed assets and PF / ESI / PT reads exactly as before', () => {
  it('every reader gives the old code\'s output', async () => {
    const root = mkdtempSync(join(tmpdir(), 'total-cut-read-'))
    const file = join(root, 'company.db')
    writeFileSync(file, gunzipSync(readFileSync(join(DIR, 'book.db.gz'))))
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${CUT_TODAY}T10:00:00`))
    const db = testFileDb(file)
    try {
      migrate(db)
      // The book really holds each cut feature's data.
      const n = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
      expect(n('SELECT COUNT(*) AS n FROM interest_charges')).toBeGreaterThan(0)
      expect(n('SELECT COUNT(*) AS n FROM depreciation_runs')).toBeGreaterThanOrEqual(2)
      expect(n("SELECT COUNT(*) AS n FROM fixed_assets WHERE status = 'disposed'")).toBe(1)
      expect(n('SELECT COUNT(*) AS n FROM payroll_lines WHERE pf_emp > 0 AND esi_emp >= 0 AND pt > 0')).toBeGreaterThan(0)
      expect(n('SELECT COUNT(*) AS n FROM statutory_payments')).toBeGreaterThanOrEqual(1)

      const got = await cutFeatureOutputs(db, readCompanyInfo(db))
      // Owner, 8 Nov (review of #243): PF / ESI due dates show only for a month a pay run deducted
      // them, so an output that carried them is compared without them — against the OLD code's
      // hash of that form (`<id>#withoutPfEsiDeadlines`, written by the generator on b2b77886).
      // Every other output must equal the old code's output exactly.
      const hashes: Record<string, string> = {}
      for (const [k, v] of Object.entries(got)) {
        if (expected[k + NO_PF_ESI]) hashes[k + NO_PF_ESI] = hashOf(withoutPfEsiDeadlines(v))
        else hashes[k] = hashOf(v)
      }
      const want = Object.fromEntries(Object.entries(expected).filter(([k]) => !expected[k + NO_PF_ESI]))
      const differ = Object.keys({ ...want, ...hashes }).filter((k) => want[k] !== hashes[k])
      if (differ.length) {
        const out = mkdtempSync(join(tmpdir(), 'total-cut-diff-'))
        for (const k of differ) writeFileSync(join(out, `${k.replace(/[^\w.-]/g, '_')}.json`), canonical(got[k] ?? null))
        console.log(`[cut features] outputs that differ written to ${out}`)
      }
      expect(differ, 'these outputs changed').toEqual([])
    } finally {
      db.close()
      vi.useRealTimers()
      rmSync(root, { recursive: true, force: true })
    }
  }, 300_000)
})
