/**
 * Phase 2c: turns the vendored GST portal workbook (HSN_SAC.xlsx, read by src/shared/xlsx) into
 * the compact list the app ships (hsnSac.json). Pure; hsnMaster.test.ts reads the workbook with
 * this function and fails unless the result equals the checked-in JSON — so the JSON is always
 * exactly the official file, with only these documented changes:
 *
 *  - the header row (HSN_CD / SAC_CD) is dropped;
 *  - a code's whitespace is removed (two goods codes are printed "2307 00" / "2514 00");
 *    SAC codes are stored as numbers in the sheet and become their digit strings;
 *  - a description's runs of whitespace (incl. the line breaks some cells hold) become one space,
 *    trimmed;
 *  - rows keep the file's order; nothing is added, merged or dropped.
 */
import { cellText, type Workbook } from '../../xlsx'

/** One row: [code, description]. */
export type HsnRow = [string, string]

export interface HsnMasterData {
  /** sources.json key of the vendored file this was generated from. */
  source: string
  /** Sheet HSN_MSTR — goods. */
  goods: HsnRow[]
  /** Sheet SAC_MSTR — services. */
  services: HsnRow[]
}

export const HSN_MASTER_FILE = 'HSN_SAC.xlsx'

function sheetRows(wb: Workbook, name: string, header: string): HsnRow[] {
  const sheet = wb.sheets.find((s) => s.name === name)
  if (!sheet) throw new Error(`${HSN_MASTER_FILE}: sheet ${name} is missing`)
  const [head, ...rows] = sheet.rows
  if (cellText(head?.cells[0] ?? null).trim() !== header) throw new Error(`${HSN_MASTER_FILE}: ${name} does not start with ${header}`)
  return rows.map((r) => {
    const code = cellText(r.cells[0] ?? null).replace(/\s+/g, '')
    const description = cellText(r.cells[1] ?? null).replace(/\s+/g, ' ').trim()
    if (!/^\d+$/.test(code)) throw new Error(`${HSN_MASTER_FILE}: ${name} row ${r.r} has code "${code}"`)
    return [code, description] as HsnRow
  })
}

export function normaliseHsnWorkbook(wb: Workbook): HsnMasterData {
  return {
    source: HSN_MASTER_FILE,
    goods: sheetRows(wb, 'HSN_MSTR', 'HSN_CD'),
    services: sheetRows(wb, 'SAC_MSTR', 'SAC_CD')
  }
}

/** The checked-in text: one row per line so a new list diffs readably. */
export function hsnMasterJson(data: HsnMasterData): string {
  const rows = (list: HsnRow[]): string => list.map((r) => JSON.stringify(r)).join(',\n')
  return `{"source":${JSON.stringify(data.source)},\n"goods":[\n${rows(data.goods)}\n],\n"services":[\n${rows(data.services)}\n]}\n`
}
