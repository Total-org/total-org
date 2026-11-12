// Audit A8 / UX-12: a CA with many client companies switches without the full-screen round trip.
// ⌘O opens the switcher over the open company (components/CompanySwitcher.tsx); picking one closes
// the current company (the unsaved-changes question first — `switchCompany`) and hands the slug to
// the company list, which opens it through its own path (passphrase prompt, integrity check,
// newer-file guard) — no second way to open a company.
import { create } from 'zustand'
import type { CompanySummary } from '@shared/domain'
import { onSessionEnd } from './sessionEnd'

/** Most recently opened first (registry `lastOpenedAt`); never-opened ones after, by name. Pure. */
export function orderCompanies<C extends Pick<CompanySummary, 'name' | 'lastOpenedAt'>>(companies: readonly C[]): C[] {
  return [...companies].sort((a, b) => {
    if (a.lastOpenedAt && b.lastOpenedAt) return a.lastOpenedAt < b.lastOpenedAt ? 1 : a.lastOpenedAt > b.lastOpenedAt ? -1 : 0
    if (a.lastOpenedAt) return -1
    if (b.lastOpenedAt) return 1
    return a.name.localeCompare(b.name)
  })
}

/** Type-to-filter: every word must appear in the name, the GSTIN or the state name. Pure. */
export function filterCompanies<C extends Pick<CompanySummary, 'name' | 'gstin'>>(companies: readonly C[], query: string, stateName: (c: C) => string = () => ''): C[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return [...companies]
  return companies.filter((c) => {
    const hay = `${c.name} ${c.gstin ?? ''} ${stateName(c)}`.toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** When ⌘O may open the switcher: an open, unlocked company with no integrity warning, on a
 *  full-app screen (a simple screen has no ⌘O), and no dialog open — a dialog owns the keyboard,
 *  and its unsaved answers (a Modal's `dirty`) are not part of the unsaved-changes question the
 *  switch asks (review of #250). Pure. */
export function switcherMayOpen(s: { slug: string | null; locked: boolean; integrityWarning: boolean; simpleScreen: boolean; layers: number }): boolean {
  return s.slug != null && !s.locked && !s.integrityWarning && !s.simpleScreen && s.layers === 0
}

interface CompanySwitchState {
  open: boolean
  /** A company picked in the switcher, waiting for the company list to open it. */
  pendingSlug: string | null
  setOpen: (open: boolean) => void
  request: (slug: string) => void
  /** The company list takes the pending slug once (null when there is none). */
  take: () => string | null
}

export const useCompanySwitch = create<CompanySwitchState>((set, get) => ({
  open: false,
  pendingSlug: null,
  setOpen: (open) => set({ open }),
  request: (pendingSlug) => set({ pendingSlug, open: false }),
  take: () => {
    const slug = get().pendingSlug
    if (slug) set({ pendingSlug: null })
    return slug
  }
}))

// A session end (lock, another user) closes the switcher; a pick already made is only a slug.
onSessionEnd(() => useCompanySwitch.getState().setOpen(false))
