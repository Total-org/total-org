import { api } from '../lib/client'
import { useT } from '../lib/i18n'
import { usePeriodPicker, useScreen, useSession, useTheme, useToasts, useNav } from '../state/stores'
import { Kbd } from '../components/ui'
import { fyOf, toMonthLabel, toPlainDate } from '@shared/dates'
import { ViewToggle } from './ViewToggle'
import { AssistantButton } from '../components/ai/AssistantButton'
import { useHelpPanel } from '../help/store'
import { helpKeyFor } from '../lib/screens'
import { PlainIcon } from './icons'
import { INTENT_SCREEN } from '@shared/simple/handoff'

// WP 10.5: chips never shrink or wrap (a two-line chip overflowed the 48 px header at 1024 px);
// the business name gives way instead (truncated, its full name in the accessible name), and the
// key hints (⌘J, ?, ⌘K) hide under 1200 px (app.css).
// UI overhaul: quiet ghost chips; Search reads as a search box; the theme switch is an icon.
const CHIP_BASE = 't-btn inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1 text-small font-medium text-muted hover:text-ink'
const CHIP = `${CHIP_BASE} border-transparent hover:bg-panel2`
/** A boxed chip (the period, Search): its own border and fill — never CHIP plus overrides, since
 *  Tailwind orders utilities by name, not by their place in the class string. */
const BOXED = `${CHIP_BASE} border-line bg-panel2 hover:border-line-strong hover:bg-panel`

/** Entry flows — every intent's screen and Quick bill: the period means nothing while a bill /
 *  payment is being written (audit UX-8). */
const ENTRY_SCREENS = new Set<string>([...Object.values(INTENT_SCREEN), 'simple-quick-bill']) // i18n-technical: registry screen name

/**
 * WP 8.1: the simple shell's header — the business name (→ business details), the dates shown,
 * "Search ⌘K" (the palette), the light / dark switch, the per-screen "Accountant view" toggle and,
 * with users, who is signed in + Lock.
 */
const SHORT = 'short' as const // i18n-technical: month-name style

export function SimpleHeader({ onOpenPalette }: { onOpenPalette: () => void }): React.JSX.Element {
  const t = useT()
  // WP 10.4 review: in Hindi the period chip names its months in Hindi (01-Apr-26 was English).
  // WP 10.8: plain dates in every language; a whole financial year is said as its months
  // ("This year: Apr 2026 – Mar 2027"), never the accountant's 01-Apr-26 → 31-Mar-27.
  const periodDate = (d: string): string => toPlainDate(d, t.lang)
  const month = (d: string): string => `${toMonthLabel(d.slice(0, 7), SHORT, t.lang)} ${d.slice(0, 4)}`
  const nav = useNav()
  const screen = useScreen()
  const toast = useToasts()
  const { info, from, to, user, setUser, setLocked, workingDate } = useSession()
  const { theme, toggle } = useTheme()
  const setPeriodOpen = usePeriodPicker((s) => s.setOpen)
  const helpOpen = useHelpPanel((s) => s.open)
  const name = info?.name ?? ''
  const openBusiness = (): void => nav.go({ name: 'company-info' })
  const lock = async (): Promise<void> => {
    try {
      await api.auth.logout()
      setUser(null)
      setLocked(true)
    } catch (err) {
      toast.push('error', (err as Error).message)
    }
  }

  return (
    <header
      data-testid="simple-header"
      className={`drag-region flex h-12 shrink-0 items-center gap-1.5 border-b border-line bg-panel pr-3 ${
        window.total.platform === 'darwin' ? 'pl-24' : 'pl-4'
      }`}
    >
      <button
        type="button"
        className="min-w-0 truncate rounded-md font-serif text-subtitle font-semibold tracking-tight"
        onClick={openBusiness}
        aria-label={t('simple.shell.businessDetails', { name })}
      >
        {name}
      </button>
      <div className="min-w-2 flex-1" />
      {!ENTRY_SCREENS.has(screen.name) && (
        <button
          type="button"
          className={BOXED}
          onClick={() => setPeriodOpen(true)}
          aria-label={t('simple.shell.period', { from: periodDate(from), to: periodDate(to) })}
          data-testid="btn-period"
        >
          <PlainIcon id="calendar" size={14} />
          {periodChip(from, to, workingDate, month, periodDate, t)}
        </button>
      )}
      <ViewToggle screen={screen} className={CHIP} />
      <AssistantButton
        label={t('simple.shell.assistant')}
        shortcut={t('simple.shell.assistantKey')}
        title={t('simple.shell.assistantHint')}
        openLabel={t('simple.shell.assistantOpen')}
        closeLabel={t('simple.shell.assistantClose')}
        className={CHIP}
      />
      <button
        type="button"
        data-testid="btn-help"
        className={CHIP}
        title={t('simple.shell.helpHint')}
        aria-expanded={helpOpen}
        onClick={() => useHelpPanel.getState().toggleForScreen(helpKeyFor(screen))}
      >
        <PlainIcon id="help" size={15} />
        {t('simple.shell.help')} <Kbd>{t('simple.shell.helpKey')}</Kbd>
      </button>
      <button
        type="button"
        data-testid="btn-theme"
        className={`${CHIP} px-2`}
        onClick={toggle}
        aria-label={t('simple.shell.themeHint', { theme })}
        title={t('simple.shell.themeHint', { theme })}
      >
        <PlainIcon id={theme === 'light' ? 'moon' : 'sun'} size={16} />
      </button>
      <button
        type="button"
        data-testid="btn-search"
        className={`${BOXED} min-w-40 justify-between`}
        onClick={onOpenPalette}
        title={t('simple.nav.searchHint')}
      >
        <span className="inline-flex items-center gap-1.5">
          <PlainIcon id="search" size={14} />
          {t('simple.nav.search')}
        </span>{' '}
        <Kbd>{t('simple.shell.searchKey')}</Kbd>
      </button>
      {user && (
        <>
          <span className={`max-w-48 truncate ${CHIP} hover:bg-transparent`} title={t('simple.shell.user', { name: user.name, role: user.role })}>
            {t('simple.shell.user', { name: user.name, role: user.role })}
          </span>
          <button
            type="button"
            data-testid="btn-lock"
            title={t('simple.shell.lockHint')}
            className={CHIP}
            onClick={() => void lock()}
          >
            <PlainIcon id="lock" size={15} />
            {t('simple.shell.lock')}
          </button>
        </>
      )}
    </header>
  )
}

/** WP 10.8: the period chip in plain words — the year that holds today, another whole year, or two dates. */
export function periodChip(
  from: string,
  to: string,
  today: string,
  month: (d: string) => string,
  date: (d: string) => string,
  t: ReturnType<typeof useT>
): string {
  const fy = fyOf(from)
  if (fy.from === from && fy.to === to) {
    const vars = { from: month(from), to: month(to) }
    return today >= from && today <= to ? t('simple.shell.periodThisYear', vars) : t('simple.shell.periodRange', vars)
  }
  return t('simple.shell.periodRange', { from: date(from), to: date(to) })
}
