// IPC channels for CSV master import, Tally import, CA export pack + Tally XML export. Registered from
// ipc.ts with its `handle` (role gate + { ok, data | error } envelope); every payload is Zod-parsed here,
// every write channel is mapped in auditCoverage.ts. Split out of ipc.ts by audit A12 (HEALTH-4) — the
// handlers were moved, not rewritten (scripts/ipc-handlers-diff.mjs compares them with origin/main).
import { dialog, shell } from 'electron'
import { readFileSync } from 'fs'
import { decodeTextFile } from '@shared/textFiles'
import { z } from 'zod'
import { backupCompany } from './db/connection'
import { readCompanyInfo } from './db/seed'
import { periodSchema, tallyImportSchema } from '@shared/schemas'
import { AppError } from '@shared/errors'
import { importTallyXml, dryRunTallyXml } from './services/tallyImport'
import * as importer from './services/importers'
import * as caPack from './services/caPack'
import { auditExport, pickExportPath, type IpcContext, type IpcHandle } from './ipcCommon'

/** Paths the Tally-import file dialog has actually issued this session. A `filePath` supplied in
 *  a tally:import payload must be one of these — otherwise the renderer could pass any path on
 *  disk and have it read straight into the app (arbitrary file read). The dryRun -> apply wizard
 *  flow still works: dryRun's dialog pick adds the path here, and apply's payload just needs to
 *  echo that same path back. The `xmlText` inline path (used by drivers/tests) is unaffected. */
const dialogIssuedTallyPaths = new Set<string>()

export function registerImportExportIpc(handle: IpcHandle, { requireCompany, canSeeProfitNow, canChangeCompanyInfo }: IpcContext): void {
  // ---------- CSV master import ----------
  const importKindSchema = z.enum(['ledgers', 'items', 'openings'])
  handle('import:pickCsv', async () => {
    const picked = await dialog.showOpenDialog({
      title: 'Choose a CSV file',
      filters: [{ name: 'CSV', extensions: ['csv', 'txt'] }],
      properties: ['openFile']
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    return { csvText: decodeTextFile(readFileSync(picked.filePaths[0])), fileName: picked.filePaths[0].split(/[\\/]/).pop()! }
  })
  handle('import:preview', (p) => {
    const { kind, csvText } = z.object({ kind: importKindSchema, csvText: z.string() }).parse(p)
    return importer.previewImport(requireCompany().db, kind, csvText)
  })
  handle('import:apply', async (p) => {
    const { kind, csvText } = z.object({ kind: importKindSchema, csvText: z.string() }).parse(p)
    const c = requireCompany()
    await backupCompany(c.db, c.slug, `pre-import-${kind}`)
    return importer.applyImport(c.db, kind, csvText)
  })
  handle('import:template', (p) => {
    const { kind } = z.object({ kind: importKindSchema }).parse(p)
    const c = requireCompany()
    const path = importer.writeTemplateCsv(c.slug, kind)
    auditExport(c.db, 'import_template', { importKind: kind, path })
    shell.showItemInFolder(path)
    return { path }
  })

  // ---------- Tally import ----------
  // WP 7.3: user files are read through decodeTextFile — Windows tools write UTF-8 with a BOM and
  // UTF-16LE (Tally's "Unicode" XML export, Excel "Unicode Text"), which 'utf8' would garble.
  handle('tally:import', async (p) => {
    const { xmlText, filePath, dryRun } = tallyImportSchema.parse(p ?? {})
    const c = requireCompany()
    let xml = xmlText
    let resolvedPath = filePath
    if (xml === undefined && filePath !== undefined) {
      if (!dialogIssuedTallyPaths.has(filePath)) throw new Error('File path must come from the file picker')
      xml = decodeTextFile(readFileSync(filePath))
    }
    if (xml === undefined) {
      const picked = await dialog.showOpenDialog({
        title: 'Choose a Tally XML export (Masters and/or Vouchers)',
        filters: [{ name: 'Tally XML', extensions: ['xml', 'txt'] }],
        properties: ['openFile']
      })
      if (picked.canceled || !picked.filePaths[0]) return null
      resolvedPath = picked.filePaths[0]
      dialogIssuedTallyPaths.add(resolvedPath)
      xml = decodeTextFile(readFileSync(resolvedPath))
    }
    // Dry run is parse-only — zero DB writes, so no backup is taken (nothing to roll back to).
    if (dryRun) return { filePath: resolvedPath ?? null, summary: dryRunTallyXml(xml) }
    await backupCompany(c.db, c.slug, 'pre-tally-import')
    // WP 6.3: the import may set booksFrom (owner only — the company:updateInfo rule); keep the
    // cached company info in step with what it wrote.
    const summary = importTallyXml(c.db, xml, { canSetBooksFrom: canChangeCompanyInfo() })
    if (summary.booksFromSet !== null) c.info = readCompanyInfo(c.db)
    return { filePath: resolvedPath ?? null, summary }
  })

  // ---------- CA export pack + Tally XML export ----------
  handle('export:caPack', async (p) => {
    const { from, to } = periodSchema.parse(p)
    const c = requireCompany()
    // PR #127 review: the pack holds profit-and-loss.csv and balance-sheet.csv — canExport alone
    // must not hand them to a sign-in that may not see profit.
    if (!canSeeProfitNow()) throw new AppError('not_permitted', 'The CA pack includes the profit and loss and the balance sheet, which are not shown to your account')
    const target = await pickExportPath(c.slug, { defaultName: caPack.caPackFolderName(from, to), title: 'Save the CA pack (a folder)', kind: 'folder' })
    if (!target) return { path: '', cancelled: true }
    const r = caPack.exportCaPack(c.db, c.info, c.slug, from, to, target)
    auditExport(c.db, 'ca_pack', { from, to, path: r.path })
    shell.showItemInFolder(r.path)
    return r
  })
  handle('export:tallyXml', (p) => {
    const { from, to } = periodSchema.parse(p)
    const c = requireCompany()
    const r = caPack.exportTallyXml(c.db, c.info, c.slug, from, to)
    auditExport(c.db, 'tally_xml', { from, to, path: r.path })
    shell.showItemInFolder(r.path)
    return r
  })
}
