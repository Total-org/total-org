import { useCallback, useEffect, useState } from 'react'
import { useSession } from '../state/stores'

/**
 * Recent searches and recently opened records for the ⌘K palette — a per-company (and, once
 * someone is signed in, per-user) display preference, persisted to localStorage under
 * `total-search-recents-<company-slug>` (`…-<slug>:u<user id>` for a signed-in user — audit A3:
 * the next person to sign in never sees the last one's searched parties / entries; same convention
 * as navSections.ts / reportConfig.ts), never to the company database.
 *
 * Last RECENT_LIMIT of each list, most recent first, de-duplicated (queries case-insensitively,
 * records by id).
 */

export const RECENT_LIMIT = 10

export interface RecentRecord {
  id: number
  label: string
  sub?: string
}

export interface SearchRecents {
  queries: string[]
  ledgers: RecentRecord[]
  items: RecentRecord[]
  vouchers: RecentRecord[]
}

export type RecentKind = 'ledger' | 'item' | 'voucher'

const LIST: Record<RecentKind, 'ledgers' | 'items' | 'vouchers'> = { ledger: 'ledgers', item: 'items', voucher: 'vouchers' }

export const EMPTY_RECENTS: SearchRecents = { queries: [], ledgers: [], items: [], vouchers: [] }

/** `userId` defaults to the signed-in user (null in a company without users = the old key). */
export function recentsKey(slug: string | null, userId: number | null = useSession.getState().user?.id ?? null): string {
  return `total-search-recents-${slug ?? 'nocompany'}${userId !== null ? `:u${userId}` : ''}`
}

export function loadRecents(slug: string | null): SearchRecents {
  try {
    const raw = localStorage.getItem(recentsKey(slug))
    if (!raw) return EMPTY_RECENTS
    const v = JSON.parse(raw) as Partial<SearchRecents>
    const recs = (x: unknown): RecentRecord[] =>
      Array.isArray(x)
        ? x.filter((r): r is RecentRecord => !!r && typeof r.id === 'number' && typeof r.label === 'string').slice(0, RECENT_LIMIT)
        : []
    return {
      queries: Array.isArray(v.queries) ? v.queries.filter((q): q is string => typeof q === 'string').slice(0, RECENT_LIMIT) : [],
      ledgers: recs(v.ledgers),
      items: recs(v.items),
      vouchers: recs(v.vouchers)
    }
  } catch {
    return EMPTY_RECENTS
  }
}

function save(slug: string | null, r: SearchRecents): void {
  try {
    localStorage.setItem(recentsKey(slug), JSON.stringify(r))
  } catch {
    /* storage full / disabled — recents are best-effort */
  }
}

/** Pure: put `q` at the front of the recent queries. */
export function withQuery(r: SearchRecents, q: string): SearchRecents {
  const t = q.trim()
  if (t.length < 2) return r
  return { ...r, queries: [t, ...r.queries.filter((x) => x.toLowerCase() !== t.toLowerCase())].slice(0, RECENT_LIMIT) }
}

/** Pure: put a record at the front of its kind's list. */
export function withRecord(r: SearchRecents, kind: RecentKind, rec: RecentRecord): SearchRecents {
  const list = LIST[kind]
  return { ...r, [list]: [rec, ...r[list].filter((x) => x.id !== rec.id)].slice(0, RECENT_LIMIT) }
}

/** Record a search / an opened record from anywhere (palette, results screen). */
export function rememberQuery(slug: string | null, q: string): void {
  save(slug, withQuery(loadRecents(slug), q))
}

export function rememberRecord(slug: string | null, kind: RecentKind, rec: RecentRecord): void {
  save(slug, withRecord(loadRecents(slug), kind, rec))
}

export function useSearchRecents(): {
  recents: SearchRecents
  addQuery: (q: string) => void
  addRecord: (kind: RecentKind, rec: RecentRecord) => void
  clear: () => void
} {
  const slug = useSession((s) => s.slug)
  const userId = useSession((s) => s.user?.id ?? null)
  const [recents, setRecents] = useState<SearchRecents>(() => loadRecents(slug))
  useEffect(() => setRecents(loadRecents(slug)), [slug, userId])
  const addQuery = useCallback(
    (q: string) => {
      const next = withQuery(loadRecents(slug), q)
      save(slug, next)
      setRecents(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key reads the signed-in user
    [slug, userId]
  )
  const addRecord = useCallback(
    (kind: RecentKind, rec: RecentRecord) => {
      const next = withRecord(loadRecents(slug), kind, rec)
      save(slug, next)
      setRecents(next)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key reads the signed-in user
    [slug, userId]
  )
  const clear = useCallback(() => {
    save(slug, EMPTY_RECENTS)
    setRecents(EMPTY_RECENTS)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key reads the signed-in user
  }, [slug, userId])
  return { recents, addQuery, addRecord, clear }
}
