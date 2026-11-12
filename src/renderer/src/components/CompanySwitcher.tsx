// Audit A8 / UX-12: ⌘O — switch to another business without the full-screen round trip. Lists
// every other business on this computer, the last opened first, filtered as you type; Enter opens
// the highlighted one. The current company closes through `switchCompany` (the unsaved-changes
// question first) and the company list opens the pick through its own path (passphrase, integrity
// check …) — lib/companySwitch.ts. "All businesses…" is the old Switch company (the list screen).
import { useId, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { GST_STATES } from '@shared/gst/states'
import { toDisplayDate } from '@shared/dates'
import { api } from '../lib/client'
import { filterCompanies, orderCompanies, useCompanySwitch } from '../lib/companySwitch'
import { switchCompany, useSession, useToasts } from '../state/stores'
import { Modal, inputCls } from './ui'

/** The local calendar day ('YYYY-MM-DD') of a stored UTC timestamp — 00:30 IST is still that day. */
function localDay(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function CompanySwitcher(): React.JSX.Element | null {
  const open = useCompanySwitch((s) => s.open)
  if (!open) return null
  return <SwitcherDialog />
}

function SwitcherDialog(): React.JSX.Element {
  const current = useSession((s) => s.slug)
  const toast = useToasts()
  const listId = useId()
  const { data: registry } = useQuery({ queryKey: ['registry'], queryFn: api.company.list })
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const close = (): void => useCompanySwitch.getState().setOpen(false)

  const others = useMemo(() => orderCompanies((registry?.companies ?? []).filter((c) => c.slug !== current)), [registry, current])
  const shown = useMemo(() => filterCompanies(others, query, (c) => GST_STATES[c.stateCode] ?? ''), [others, query])
  // The last row is always "All businesses…".
  const rows = shown.length + 1
  const at = Math.min(active, rows - 1)

  const leave = async (slug: string | null): Promise<void> => {
    try {
      // Unsaved changes are asked about first; on "Stay" nothing closes.
      const switched = await switchCompany(api.company.close)
      if (!switched) return
      if (slug) useCompanySwitch.getState().request(slug)
      else close()
    } catch (err) {
      toast.push('error', (err as Error).message)
    }
  }
  const pick = (i: number): void => void leave(shown[i]?.slug ?? null)

  return (
    <Modal title="Switch company" onClose={close}>
      <input
        autoFocus
        className={inputCls}
        value={query}
        placeholder="Type a name, GSTIN or state"
        aria-label="Find a company"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-activedescendant={`${listId}-${at}`}
        data-testid="input-company-switch"
        onChange={(e) => {
          setQuery(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((at + 1) % rows)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((at - 1 + rows) % rows)
          } else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            pick(at)
          }
        }}
      />
      <div id={listId} role="listbox" aria-label="Companies" className="mt-2 max-h-80 overflow-auto" data-testid="list-company-switch">
        {shown.map((c, i) => (
          <div
            key={c.slug}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === at}
            data-active={i === at}
            data-testid={`company-switch-${c.slug}`}
            className="kbar-row flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-3 py-2"
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault()
              pick(i)
            }}
          >
            <span className="min-w-0">
              <span className="block truncate text-body font-medium">{c.name}</span>
              <span className="num block text-caption text-muted">
                {GST_STATES[c.stateCode] ?? c.stateCode}
                {c.gstin ? ` · ${c.gstin}` : ' · Unregistered'}
              </span>
            </span>
            <span className="num shrink-0 text-caption text-muted">{c.lastOpenedAt ? `opened ${toDisplayDate(localDay(c.lastOpenedAt))}` : 'not opened yet'}</span>
          </div>
        ))}
        {shown.length === 0 && (
          <p className="px-3 py-2 text-detail text-muted" data-testid="company-switch-none">
            {others.length === 0 ? 'No other company on this computer.' : 'No company matches.'}
          </p>
        )}
        <div
          id={`${listId}-${shown.length}`}
          role="option"
          aria-selected={at === shown.length}
          data-active={at === shown.length}
          data-testid="company-switch-all"
          className="kbar-row mt-1 cursor-pointer rounded-md border-t border-line px-3 py-2 text-detail text-muted"
          onMouseEnter={() => setActive(shown.length)}
          onMouseDown={(e) => {
            e.preventDefault()
            pick(shown.length)
          }}
        >
          All businesses… (new, sample, backups)
        </div>
      </div>
      <p className="mt-2 text-hint text-muted">↑↓ to move · Enter to open · Esc to stay here</p>
    </Modal>
  )
}
