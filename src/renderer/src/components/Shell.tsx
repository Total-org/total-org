import { useEffect, useState, type ReactNode } from 'react'
import { useIsFetching } from '@tanstack/react-query'
import { useChunkLoading } from '../lib/chunkLoading'
import { switchCompany, useNav, usePeriodPicker, useScreen, useSession, useTheme, useToasts } from '../state/stores'
import { api } from '../lib/client'
import { Button, DateInput, Kbd, Modal } from './ui'
import { SupportLink } from './SupportLink'
import { TotalLogo } from './TotalLogo'
import { toDisplayDate, fyOf, fyFromStartYear, todayISO } from '@shared/dates'
import { useFeatures } from '../lib/useFeatures'
import { ACCOUNTANT_NAV, screenApplies } from '../lib/screens'
import { useScreenView } from '../lib/mode'
import { useT } from '../lib/i18n'
import { SimpleHeader } from '../simple/SimpleHeader'
import { SimpleSidebar } from '../simple/SimpleSidebar'
import { ViewToggle } from '../simple/ViewToggle'
import { useNavSections } from '../lib/navSections'
import { AssistantPanel } from './ai/AssistantPanel'
import { AssistantButton } from './ai/AssistantButton'
import { HelpPanel } from '../simple/help/HelpPanel'
import { DockModeContext } from './kit'
import { useSimplePanelsOverlay } from '../lib/simpleLayout'
import { handleRadioArrows, handleSlashKey, useRovingRadios } from '../lib/simpleKeys'
import { PlainIcon } from '../simple/icons'

/** Sidebar derived from the single screen registry (lib/screens.ts) — accountant-mode screens. */
const NAV = ACCOUNTANT_NAV

// UI overhaul: header controls are quiet ghost chips; the amber stays for the current item.
const HEADER_CHIP_BASE = 't-btn inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-small font-medium text-muted hover:text-ink'
const HEADER_CHIP = `${HEADER_CHIP_BASE} border-transparent hover:bg-panel2`
/** Boxed (period, Anywhere): own border + fill, not HEADER_CHIP + overrides (Tailwind orders by name). */
const HEADER_BOXED = `${HEADER_CHIP_BASE} border-line bg-panel2 hover:border-line-strong hover:bg-panel`

/** Decorative icons beside the accountant sidebar's section heads and top items (aria-hidden; the
 *  pinned sidebar snapshot reads text only, so the shape is unchanged). */
const NAV_ICON: Record<string, string> = {
  books: 'book', // i18n-technical: icon ids
  trade: 'truck', // i18n-technical
  analysis: 'chart', // i18n-technical
  banking: 'bank', // i18n-technical
  payroll: 'users', // i18n-technical
  gst: 'percent', // i18n-technical
  system: 'gear', // i18n-technical
  gateway: 'home', // i18n-technical
  'voucher-entry': 'pen', // i18n-technical
  manufacture: 'factory', // i18n-technical
  'counter-billing': 'shop', // i18n-technical
  masters: 'list' // i18n-technical
}

export function Shell({ children, onOpenPalette }: { children: ReactNode; onOpenPalette: () => void }): React.JSX.Element {
  const { info, from, to, user, setUser, setLocked } = useSession()
  const screen = useScreen()
  const nav = useNav()
  const toast = useToasts()
  const { theme, toggle } = useTheme()
  const { open: periodOpen, setOpen: setPeriodOpen } = usePeriodPicker()
  const fetching = useIsFetching()
  // A lazily loaded screen still waiting for its code counts as loading (lib/lazyScreen.tsx).
  const chunksLoading = useChunkLoading((s) => s.count)
  const features = useFeatures()
  const sections = useNavSections(screen.name)
  const t = useT()
  // WP 8.1: a simple company shows its simple screens in the simple shell (header + sidebar);
  // <main> stays in place, so switching a screen's view keeps the screen (and its state) mounted.
  const simple = useScreenView(screen.name).view === 'simple'
  // WP 10.5: in the simple shell the panels open over the screen below 1600 px (lib/simpleLayout).
  const overlayPanels = useSimplePanelsOverlay()
  // WP 10.5: html[data-shell='simple'] scopes the simple shell's token tweaks (app.css) — portals
  // (dialogs, popovers) included; the full app never has it.
  useEffect(() => {
    const root = document.documentElement
    if (simple) root.dataset.shell = 'simple'
    else delete root.dataset.shell
    return () => {
      delete root.dataset.shell
    }
  }, [simple])
  // WP 10.5 (simple shell only; lib/simpleKeys.ts): `/` focuses the screen's search box, arrow
  // keys move between a question's choices.
  useEffect(() => {
    if (!simple) return
    const onKey = (e: KeyboardEvent): void => void (handleRadioArrows(e) || handleSlashKey(e))
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [simple])
  useRovingRadios(simple)
  const visibleNav = NAV.filter((s) => !s.feature || features[s.feature]).map((s) => ({
    ...s,
    items: s.items.filter((i) => (!i.feature || features[i.feature]) && screenApplies(i, info?.gstRegistrationType))
  }))
  const navBtnCls = (top: boolean): string =>
    `t-nav-item flex w-full items-center gap-2 rounded-md py-[5px] text-left text-detail text-muted hover:bg-ink/5 hover:text-ink ${top ? 'px-2.5' : 'pr-2.5 pl-8'}`

  return (
    <div className="flex h-full flex-col">
      {/* Skip link: the first Tab stop on every screen jumps past the header and sidebar. */}
      <a
        href="#main"
        data-testid="skip-to-content"
        onClick={(e) => {
          e.preventDefault()
          document.getElementById('main')?.focus()
        }}
        className="sr-only z-50 rounded-md bg-amberbar px-3 py-1.5 text-detail font-semibold text-on-amber focus:not-sr-only focus:fixed focus:top-2 focus:left-24"
      >
        {simple ? t('simple.shell.skip') : 'Skip to content'}
      </a>
      {simple ? <SimpleHeader onOpenPalette={onOpenPalette} /> : <header
        className={`drag-region flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-panel pr-3 ${
          window.total.platform === 'darwin' ? 'pl-24' : 'pl-4'
        }`}
      >
        <button
          type="button"
          className="flex items-baseline gap-2 rounded-md"
          onClick={() => nav.go({ name: 'company-info' })}
          title="Company details"
          aria-label={`${info?.name ?? 'Company'} — company details`}
        >
          <span className="font-serif text-subtitle font-semibold tracking-tight">{info?.name}</span>
          {info?.gstin && <span className="font-mono text-label text-muted">{info.gstin}</span>}
        </button>
        <div className="flex-1" />
        {/* "Back to simple" — only in a simple company (renders nothing otherwise). */}
        <ViewToggle screen={screen} className={HEADER_CHIP} />
        <button
          type="button"
          className={`num ${HEADER_BOXED}`}
          onClick={() => setPeriodOpen(true)}
          title="Change period"
          aria-label={`Working period ${toDisplayDate(from)} to ${toDisplayDate(to)} — change`}
          data-testid="btn-period"
        >
          {toDisplayDate(from)} → {toDisplayDate(to)}
        </button>
        <AssistantButton
          label="Assistant"
          shortcut="⌘J"
          title="Ask about your books (optional; off until turned on in Settings → AI)"
          openLabel="Open the assistant (⌘J)"
          closeLabel="Close the assistant (⌘J)"
          className={HEADER_CHIP}
        />
        <button
          type="button"
          data-testid="btn-theme"
          className={HEADER_CHIP}
          onClick={toggle}
          title="Switch theme (Settings → Appearance for density and more)"
          aria-label={theme === 'light' ? 'Switch to the dark theme' : 'Switch to the light theme'}
        >
          <PlainIcon id={theme === 'light' ? 'moon' : 'sun'} size={15} />
          {theme === 'light' ? 'Dark' : 'Light'}
        </button>
        <button
          type="button"
          className={`${HEADER_BOXED} min-w-44 justify-between`}
          onClick={onOpenPalette}
          aria-label="Go anywhere (command palette, ⌘K)"
        >
          <span className="inline-flex items-center gap-1.5">
            <PlainIcon id="search" size={14} />
            Anywhere
          </span>{' '}
          <Kbd>⌘K</Kbd>
        </button>
        {user && (
          <>
            <span className="rounded-md px-2.5 py-1 text-small text-muted capitalize">
              {user.name} · {user.role}
            </span>
            <button
              type="button"
              data-testid="btn-lock"
              aria-label="Lock the company"
              className={HEADER_CHIP}
              onClick={async () => {
                try {
                  await api.auth.logout()
                  setUser(null)
                  setLocked(true)
                } catch (err) {
                  toast.push('error', (err as Error).message)
                }
              }}
            >
              Lock
            </button>
          </>
        )}
      </header>}

      <div className="flex min-h-0 flex-1">
        {simple ? <SimpleSidebar /> : <nav aria-label="Main" className="flex w-48 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-line bg-sidebar p-2">
          <div className="mb-2 flex items-center gap-2 px-2 py-2">
            <TotalLogo size={28} />
            <span className="font-serif text-brand font-semibold tracking-tight">Total</span>
          </div>
          {visibleNav.map((section) => {
            const open = sections.isOpen(section.id)
            const listId = `nav-list-${section.id}`
            return (
              <div key={section.id}>
                {section.title && (
                  <button
                    type="button"
                    data-testid={`nav-section-${section.id}`}
                    aria-expanded={open}
                    aria-controls={listId}
                    onClick={() => sections.toggle(section.id)}
                    onKeyDown={(e) => {
                      // ←/→ collapse/expand, like a tree; ↵/Space toggle via the native button.
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        sections.setOpen(section.id, e.key === 'ArrowRight')
                      }
                    }}
                    className="t-nav-item mt-2 flex w-full items-center gap-2 rounded-md px-2.5 py-[5px] text-left text-detail font-semibold text-ink/80 hover:bg-ink/5 hover:text-ink"
                  >
                    <PlainIcon id={NAV_ICON[section.id] ?? 'dot'} size={16} className="t-nav-icon shrink-0" />
                    <span className="flex-1">{section.title}</span>
                    <span aria-hidden className="inline-block w-3 text-center text-micro text-muted">{open ? '▾' : '▸'}</span>
                  </button>
                )}
                {/* Collapsed items stay in the DOM (hidden) so aria-controls always resolves. */}
                <div id={listId} hidden={!open}>
                  {section.items.map((item) => {
                    const active = screen.name === item.screen.name
                    const top = !section.title
                    return (
                      <button
                        type="button"
                        key={item.label}
                        data-testid={`nav-${item.screen.name}`}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => nav.go(item.screen)}
                        className={navBtnCls(top)}
                      >
                        {top && <PlainIcon id={NAV_ICON[item.screen.name] ?? 'dot'} size={16} className="t-nav-icon shrink-0" />}
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
          <div className="flex-1" />
          <button
            type="button"
            className="rounded-md px-2.5 py-1.5 text-left text-body-sm text-muted hover:bg-panel2 hover:text-ink"
            onClick={async () => {
              try {
                await api.company.backup()
                toast.push('success', 'Backup saved')
              } catch (err) {
                toast.push('error', (err as Error).message)
              }
            }}
          >
            Back up now
          </button>
          <button
            type="button"
            data-testid="btn-switch-company"
            className="rounded-md px-2.5 py-1.5 text-left text-body-sm text-muted hover:bg-panel2 hover:text-ink"
            onClick={async () => {
              try {
                await switchCompany(api.company.close)
              } catch (err) {
                toast.push('error', (err as Error).message)
              }
            }}
          >
            Switch company
          </button>
          <div className="mt-2 border-t border-line pt-2">
            <SupportLink />
          </div>
        </nav>}

        {/* data-screen + data-loading: the E2E harness's navigation/idle markers (lib/testids.ts). */}
        <main
          id="main"
          tabIndex={-1}
          data-screen={screen.name}
          data-loading={fetching > 0 || chunksLoading > 0 ? 'true' : 'false'}
          className="min-h-0 flex-1 overflow-auto p-page outline-none"
        >
          {children}
        </main>
        {/* WP 5.2: docked beside the screen (the screen narrows), on every screen. WP 10.5: in
            the simple shell they are Esc layers and overlay the screen below 1600 px. */}
        <DockModeContext.Provider value={simple ? (overlayPanels ? 'overlay' : 'dock') : null}>
          <AssistantPanel />
          {/* WP 10.3: the help panel (simple companies only; renders nothing in the full app). */}
          <HelpPanel />
        </DockModeContext.Provider>
      </div>

      {periodOpen && <PeriodModal onClose={() => setPeriodOpen(false)} />}
    </div>
  )
}

function PeriodModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { from, to, setPeriod, info } = useSession()
  const [f, setF] = useState(from)
  const [t, setT] = useState(to)
  const currentFy = fyOf(todayISO())
  const years: number[] = []
  for (let y = info?.booksFrom ?? currentFy.startYear; y <= currentFy.startYear; y++) years.push(y)

  return (
    <Modal title="Working period" onClose={onClose}>
      <div className="flex gap-3">
        <div className="flex-1">
          <span className="mb-1 block text-caption font-semibold tracking-[0.08em] text-muted uppercase">From</span>
          <DateInput value={f} context={f} onChange={setF} testId="input-period-from" ariaLabel="From" />
        </div>
        <div className="flex-1">
          <span className="mb-1 block text-caption font-semibold tracking-[0.08em] text-muted uppercase">To</span>
          <DateInput value={t} context={t} onChange={setT} testId="input-period-to" ariaLabel="To" />

        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {years.reverse().map((y) => {
          const fy = fyFromStartYear(y)
          return (
            <Button key={y} onClick={() => { setF(fy.from); setT(fy.to) }}>
              FY {fy.label}
            </Button>
          )
        })}
        <Button
          onClick={() => {
            const today = todayISO()
            setF(today.slice(0, 8) + '01')
            setT(today)
          }}
        >
          This month
        </Button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="primary"
          data-testid="btn-apply-period"
          onClick={() => {
            setPeriod(f, t)
            onClose()
          }}
        >
          Apply period
        </Button>
      </div>
    </Modal>
  )
}
