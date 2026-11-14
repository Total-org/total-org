import { useQuery } from '@tanstack/react-query'
import { toPlainDate } from '@shared/dates'
import { taxesPeriodLabel } from '@shared/simple/explain'
import { api } from '../lib/client'
import { useT } from '../lib/i18n'
import { useAiAffordances } from '../lib/explain'
import { screenDef, simpleEntriesOf, simpleEntryVisible, SIMPLE_SECTIONS, type ResolvedSimpleEntry } from '../lib/screens'
import { useFeatures } from '../lib/useFeatures'
import { useNav, useSession } from '../state/stores'
import { Button, Page } from '../components/ui'
import { useAccountantView } from '../lib/handoff'
import { AccountantViewButton } from './AccountantViewButton'
import { CaCheck } from '../components/CaCheck'
import { money } from './reports/parts'
import type { SimpleSectionId } from '@shared/simple/uiMode'
import type { SimpleTaxes } from '@shared/simple/taxes'

/** Entries a section shows for this company: features on, the GST returns (GSTR-1 / 3B / 2B) only
 *  for a REGULAR registration (never while the company details are still loading), "Snap a bill"
 *  only while the AI assistant is ready. */
export function useVisibleEntries(section: SimpleSectionId): ResolvedSimpleEntry[] {
  const features = useFeatures()
  const aiReady = useAiAffordances()
  const regular = useSession((s) => s.info?.gstRegistrationType === 'regular')
  return simpleEntriesOf(section).filter((e) => simpleEntryVisible(e, { features, regular, aiReady }))
}

/**
 * WP 8.1: a simple section's page (Sell, Buy, Money …): its plain-named entries, each opening the
 * mapped EXISTING screen (plan §2.3) — inside the simple shell with the "Accountant view"
 * toggle, or in the full app for accountant-only screens (tagged "Full app"). The simple-native
 * flows replace these in Phase 9.
 */
export function SimpleSection({ section }: { section: SimpleSectionId }): React.JSX.Element {
  const t = useT()
  const entries = useVisibleEntries(section)
  const gstType = useSession((s) => s.info?.gstRegistrationType ?? null)
  const nav = useNav()
  const openFull = useAccountantView({ name: 'simple-section', section })
  const meta = SIMPLE_SECTIONS.find((s) => s.id === section)
  const title = meta ? t(meta.label) : '' // i18n-technical: registry key (simple.nav.*)
  // A9 (audit UX-5): on Taxes the plain GST screen is the card at the top (figure + due date), so
  // its entry is not listed again, and the screens that open in the full app go under "For your CA"
  // as on Reports.
  const taxes = section === 'taxes'
  const gstCard = taxes && gstType === 'regular'
  const listed = gstCard ? entries.filter((e) => e.screenName !== 'simple-taxes') : entries
  const main = listed.filter((e) => e.group === null && !(taxes && accountantOnly(e)))
  const ca = listed.filter((e) => e.group === 'forYourCa' || (taxes && e.group === null && accountantOnly(e)))

  return (
    <Page data-testid={`simple-section-${section}`}>
      {section === 'reports' ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <h1 className="font-serif text-display font-semibold tracking-[-0.025em] text-ink">{title}</h1>
          {/* WP 9.10: the accountant reports (the Trial balance first). */}
          <AccountantViewButton testId="btn-reports-accountant-view" title={t('simple.shell.accountantViewHint')} onOpen={(always) => void openFull({ intent: null, always })} />
        </div>
      ) : (
        <h1 className="mb-5 font-serif text-display font-semibold tracking-[-0.025em] text-ink">{title}</h1>
      )}
      {section === 'taxes' && gstType === 'unregistered' && (
        <p className="mb-4 text-detail text-muted" data-testid="simple-taxes-unregistered">
          {t('simple.taxes.gst.unregistered')}
        </p>
      )}
      {section === 'taxes' && gstType === 'composition' && (
        <section className="mb-4 rounded-xl border border-line bg-panel p-panel shadow-elev-1" data-testid="simple-taxes-composition">
          <h2 className="text-lead font-semibold text-ink">{t('simple.taxes.gst.compositionTitle')}</h2>
          <p className="mt-1 text-detail text-muted">{t('simple.taxes.gst.composition')}</p>
          {/* WP 9.9: the Taxes screen has the cited CMP-08 / GSTR-4 dates; its entries are for a
              regular registration only, so the composition card is the way in. */}
          <button
            type="button"
            data-testid="simple-taxes-composition-open"
            onClick={() => nav.go(taxesScreen)}
            className="t-btn mt-3 rounded-md border border-line-strong/80 bg-panel px-3 py-1.5 text-detail font-medium text-ink hover:border-line-strong hover:bg-panel2"
          >
            {t('simple.taxes.composition.open')}
          </button>
        </section>
      )}
      {gstCard && <TaxesGstCard />}
      {entries.length === 0 && <p className="text-detail text-muted">{t('simple.section.empty')}</p>}
      <EntryGrid entries={main} />
      {ca.length > 0 && (
        <>
          <h2 className="mt-7 mb-3 text-subtitle font-semibold text-ink">{t('simple.reports.forYourCa')}</h2>
          <EntryGrid entries={ca} />
        </>
      )}
    </Page>
  )
}

const taxesScreen = { name: 'simple-taxes' } as const // i18n-technical

/**
 * A9 (audit UX-5): the Taxes hub's GST card for a regular registration — what the Home tile and
 * the Taxes screen show by default (simple:taxes with no period: dashGst's period), the cash to
 * pay and both due dates, and one button to the plain GST screen. The same query as TaxesScreen's
 * default, so opening it next is instant. While it loads (or if it fails) the button still works.
 */
function TaxesGstCard(): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  const today = useSession((s) => s.workingDate)
  const q = useQuery({ queryKey: ['simpleTaxes', null, today], queryFn: () => api.simpleTaxes.get(undefined, today) }) // i18n-technical
  const x = q.data?.kind === 'regular' ? (q.data as Extract<SimpleTaxes, { kind: 'regular' }>) : null
  return (
    <section className="mb-6 rounded-xl border border-line bg-panel p-panel shadow-elev-1" data-testid="simple-taxes-gst-card" aria-busy={q.isLoading}>
      <h2 className="text-lead font-semibold text-ink">
        {x ? t('simple.taxes.hub.title', { period: taxesPeriodLabel(x.period, t) }) : t('simple.taxes.hub.titlePlain')}
      </h2>
      {x ? (
        <>
          <p className="mt-2 flex items-center gap-2 text-detail text-muted">
            {t('simple.taxes.gst.toPayLabel')}
            <CaCheck place="simple.taxes.toPay" />
          </p>
          <p className="num text-display font-semibold text-ink" data-testid="simple-taxes-hub-to-pay">
            {money(x.figures.toPay)}
          </p>
          <ul className="mt-2 space-y-0.5 text-detail text-muted">
            <li className="flex flex-wrap items-center gap-x-2">
              <span data-testid="simple-taxes-hub-due-gstr1">{t('simple.taxes.due.gstr1', { date: toPlainDate(x.due.gstr1, t.lang) })}</span>
              <CaCheck place="simple.taxes.dueGstr1" />
            </li>
            <li className="flex flex-wrap items-center gap-x-2">
              <span data-testid="simple-taxes-hub-due-gstr3b">{t('simple.taxes.due.gstr3b', { date: toPlainDate(x.due.gstr3b, t.lang) })}</span>
              <CaCheck place="simple.taxes.dueGstr3b" quarterly={x.period.quarterly} />
            </li>
          </ul>
          {/* Review of #282: the same "check with your CA" points and UNVERIFIED note as the Taxes screen. */}
          {x.due.gstr3bUnverified && (
            <p className="mt-1 text-small text-muted" data-testid="simple-taxes-hub-unverified">
              {t('simple.taxes.due.unverified')}
            </p>
          )}
        </>
      ) : q.isLoading ? (
        <div className="mt-2 h-[5.5rem]" aria-hidden="true" />
      ) : null}
      <Button variant="primary" className="mt-3" data-testid="simple-taxes-hub-open" onClick={() => nav.go(taxesScreen)}>
        {t('simple.taxes.hub.open')}
      </Button>
    </section>
  )
}

/** The entry opens a screen that only has an accountant view (it shows in the full app). */
const accountantOnly = (e: ResolvedSimpleEntry): boolean => !screenDef(e.screenName)?.modes.includes('simple')

function EntryGrid({ entries }: { entries: ResolvedSimpleEntry[] }): React.JSX.Element | null {
  const t = useT()
  const nav = useNav()
  if (entries.length === 0) return null
  return (
    <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {entries.map((e) => {
        const label = t(e.label) // i18n-technical: registry key (simple.* / common.*), checked in simpleRegistry.test
        const fullApp = accountantOnly(e)
        return (
          <li key={e.id}>
            <button
              type="button"
              data-testid={`simple-entry-${e.id}`}
              onClick={() => nav.go(e.screen)}
              className="t-btn group flex h-full w-full items-center justify-between gap-3 rounded-xl border border-line bg-panel px-panel py-4 text-left shadow-elev-1 hover:border-line-strong hover:shadow-elev-2"
            >
              <span className="text-lead font-medium text-ink">{label}</span>
              <span className="flex shrink-0 items-center gap-2">
                {fullApp && (
                  <span className="rounded-sm border border-line bg-panel2 px-1.5 py-px text-caption font-medium text-muted" title={t('simple.shell.fullAppHint')}>
                    {t('simple.shell.fullApp')}
                  </span>
                )}
                <span aria-hidden="true" className="text-muted group-hover:text-ink">
                  →
                </span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
