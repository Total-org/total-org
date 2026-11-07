/**
 * Phase 2c (owner decision D4): HSN / SAC search and checks over the GST portal's own list
 * (src/shared/gst/hsnMaster/ — vendored byte-for-byte, sources.json; GST_SOURCES.hsnMaster).
 *
 * Pure: the caller hands in the list (the renderer loads it lazily — lib/hsnMaster.ts — and main
 * through a dynamic import, so it never sits in a startup bundle).
 *
 * What it does NOT do: suggest a GST rate. The official list has codes and descriptions only and
 * no official, machine-readable code → rate mapping is bundled, so every screen says "check the
 * rate with your CA" and never fills a rate in (GST_UNVERIFIED 'hsn-master-list'). Nothing here
 * changes a stored item's HSN or rate.
 *
 * Digits (rule 46 of the CGST Rules, Notification 12/2017-CT as amended):
 *  - Notification 78/2020-CT (from 1 April 2021): 4 digits up to ₹5 crore aggregate turnover in
 *    the preceding FY, 6 above it; up to ₹5 crore the code may be left off invoices to
 *    unregistered persons (GST_SOURCES.n78_2020, read in the official copy).
 *  - Notification 90/2020-CT: 8 digits for the 49 chemicals in its Table (GST_SOURCES.n90_2020).
 * Total does not store the turnover, so a 4-digit code gets a note, never an error
 * (GST_UNVERIFIED 'hsn-digits').
 */
import type { HsnMasterData } from './hsnMaster/normalise'

export type HsnKind = 'goods' | 'services'

export interface HsnEntry {
  code: string
  description: string
  kind: HsnKind
}

export interface HsnIndex {
  entries: readonly HsnEntry[]
  byCode: ReadonlyMap<string, HsnEntry>
  /** Lower-case words of each entry's description, same order as `entries`. */
  words: readonly (readonly string[])[]
}

/** Codes a bill may carry (rule 46 tables: 4, 6 or 8 digits). Chapters (2 digits) are context only. */
export const HSN_LENGTHS = [4, 6, 8] as const

/** Notification 90/2020-CT, column (3) — the eight-digit codes of its Table, as printed
 *  (S.No. 18 and 27 read "As applicable" and are left out; 19/20 and 21–26 share codes). */
export const EIGHT_DIGIT_HSN_N90_2020: readonly string[] = [
  '38249100', '29313200', '29313600', '29313700', '29313500', '29313100', '29313300', '29313800',
  '29313400', '29181700', '29211400', '29211200', '29211300', '29221800', '29306000', '29307000',
  '29309092', '29333930', '29313900', '38249900', '39072090', '39119090', '28121100', '28531000',
  '28111200', '29049100', '28121200', '28121300', '28121400', '29202300', '29202400', '29202100',
  '29202200', '28121500', '28121600', '28121700', '29221720', '29221710', '29221500'
]

/** Above this aggregate turnover in the preceding FY a bill needs 6 digits (Notification 78/2020-CT). */
export const HSN_SIX_DIGITS_ABOVE_TURNOVER_PAISE = 5_00_00_000 * 100

const wordsOf = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

export function createHsnIndex(data: Pick<HsnMasterData, 'goods' | 'services'>): HsnIndex {
  const all: HsnEntry[] = [
    ...data.goods.map(([code, description]) => ({ code, description, kind: 'goods' as const })),
    ...data.services.map(([code, description]) => ({ code, description, kind: 'services' as const }))
  ]
  // The portal's sheet lists two codes twice (hsnMaster.test.ts): the first row of a code wins.
  const byCode = new Map<string, HsnEntry>()
  const entries: HsnEntry[] = []
  for (const e of all) if (!byCode.has(e.code)) { byCode.set(e.code, e); entries.push(e) }
  return { entries, byCode, words: entries.map((e) => [...new Set(wordsOf(e.description))]) }
}

/** The code as typed with spaces / dots removed ("1006 30" → "100630"); null when it holds anything else. */
export function cleanHsn(raw: string): string | null {
  const s = raw.replace(/[\s.]/g, '')
  return /^\d+$/.test(s) ? s : null
}

export function lookupHsn(index: HsnIndex, raw: string): HsnEntry | null {
  const code = cleanHsn(raw)
  return code ? index.byCode.get(code) ?? null : null
}

/** The nearest heading / chapter the list has for a code (the code itself first). */
export function hsnParent(index: HsnIndex, raw: string): HsnEntry | null {
  const code = cleanHsn(raw)
  if (!code) return null
  for (let n = code.length; n >= 2; n--) {
    const e = index.byCode.get(code.slice(0, n))
    if (e) return e
  }
  return null
}

/**
 * Search by code or words. Digits (spaces allowed) match codes by PREFIX; other words must each
 * start a word of the description (any order, case-insensitive). Both together narrow both ways
 * ("1006 broken"). Only codes a bill may carry (4 / 6 / 8 digits) are returned. Order: words
 * matched whole before words matched as a prefix, then shorter codes (the heading before its
 * sub-headings), then code order.
 */
export function searchHsn(index: HsnIndex, query: string, limit = 20): HsnEntry[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
  if (!tokens.length) return []
  // Digits typed with spaces inside ("1006 30") are one code; a lone number among words is a code too.
  const codePrefix = /^[\d\s.]+$/.test(query.trim()) ? query.replace(/[\s.]/g, '') : tokens.filter((t) => /^\d+$/.test(t)).join('')
  const words = /^[\d\s.]+$/.test(query.trim()) ? [] : tokens.filter((t) => !/^\d+$/.test(t))
  const hits: { e: HsnEntry; exact: number }[] = []
  for (let i = 0; i < index.entries.length; i++) {
    const e = index.entries[i]!
    if (!(HSN_LENGTHS as readonly number[]).includes(e.code.length)) continue
    if (codePrefix && !e.code.startsWith(codePrefix)) continue
    let exact = 0
    let ok = true
    if (words.length) {
      const ws = index.words[i]!
      for (const q of words) {
        let found = false
        for (const w of ws) {
          if (w === q) { exact++; found = true; break }
          if (!found && w.startsWith(q)) found = true
        }
        if (!found) { ok = false; break }
      }
    }
    if (ok) hits.push({ e, exact })
  }
  hits.sort((a, b) => b.exact - a.exact || a.e.code.length - b.e.code.length || (a.e.code < b.e.code ? -1 : a.e.code > b.e.code ? 1 : 0))
  return hits.slice(0, limit).map((h) => h.e)
}

export type HsnProblem = 'digits' | 'length'
export type HsnNote = 'not_in_list' | 'four_digits' | 'eight_digits'

export interface HsnCheck {
  /** The cleaned code (null when it is not digits). */
  code: string | null
  /** A structural problem — the field is wrong as typed. */
  problem: HsnProblem | null
  /** Advice that never blocks a save. */
  notes: HsnNote[]
  /** The list's entry for the code, when there is one. */
  entry: HsnEntry | null
}

/**
 * Checks a typed HSN / SAC. `problem` is the old validateHsn rule (digits; 4, 6 or 8 of them).
 * Notes, never errors: not in the portal's list (when `index` is given), 4 digits (6 needed above
 * ₹5 crore turnover), or a code that starts like one of Notification 90/2020's chemicals and is
 * shorter than 8 digits.
 */
export function checkHsn(raw: string, index?: HsnIndex | null): HsnCheck {
  const code = cleanHsn(raw)
  if (!code) return { code: null, problem: 'digits', notes: [], entry: null }
  if (!(HSN_LENGTHS as readonly number[]).includes(code.length)) return { code, problem: 'length', notes: [], entry: null }
  const notes: HsnNote[] = []
  const entry = index ? index.byCode.get(code) ?? null : null
  if (index && !entry) notes.push('not_in_list')
  if (code.length === 4) notes.push('four_digits')
  if (code.length < 8 && EIGHT_DIGIT_HSN_N90_2020.some((c) => c.startsWith(code))) notes.push('eight_digits')
  return { code, problem: null, notes, entry }
}

/** Descriptions join a heading and its line with "~" in the portal's file; shown as " › ". */
export function hsnDescription(e: HsnEntry): string {
  return e.description.replace(/\s*~\s*/g, ' › ')
}
