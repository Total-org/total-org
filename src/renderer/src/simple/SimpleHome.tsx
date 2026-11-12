import { useState, type ReactNode } from 'react'
import { daysAgo } from '@shared/backupCheck'
import { useAssistantPanel } from '../components/ai/AssistantPanel'
import { useAskTotal } from './AskTotal'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/client'
import { useT } from '../lib/i18n'
import { useNav, useSession } from '../state/stores'
import { Page } from '../components/ui'
import { Button, Skeleton, Why } from '../components/kit'
import { OpeningsHomeCard } from './OpeningsHomeCard'
import { ApprovalsHomeCard } from './queue/ApprovalsHomeCard'
import { useCanWrite, ViewerBackupNote } from './ViewerNote'
import { HomeTour } from './help/Tour'
import { PlainIcon } from './icons'
import { HOME_TASKS, accountScreen, attentionScreen, deadlineScreen, homeReportScreen, homeSetupScreen, type HomeReport } from './homeTasks'
import { onboardingFromDashSetup, type OnboardingChecklist, type OnboardingStepId } from '@shared/onboarding'
import { todayISO, toPlainDate } from '@shared/dates'
import type { MessageKey } from '@shared/i18n'
import { homeAttentionRows, isEmptyHome, owedAttention, type HomeGst, type SimpleHomeData } from '@shared/simple/home'
import {
  attentionText, cashWhy, compositionDueWhy, deadlineText, deadlineWhy, gstLine, gstLinkLabel, gstWhy, homeProfitWhy, money, monthCompareWhy, moneyInWhy, moneyOutWhy, payablesWhy, pmt06Why, profitSentence,
  receivablesWhy
} from '@shared/simple/explain'
import { CaCheck } from '../components/CaCheck'

/** Plain labels for the onboarding steps, keyed by step id (the step logic stays in onboarding.ts).
 *  WP 8.7's "Enter what you had on day one" is its own card (OpeningsHomeCard) above them. */
const STEP_LABEL: Record<OnboardingStepId, { label: MessageKey; hint: MessageKey }> = {
  company: { label: 'simple.setupSteps.company.label', hint: 'simple.setupSteps.company.hint' },
  gstin: { label: 'simple.setupSteps.gstin.label', hint: 'simple.setupSteps.gstin.hint' },
  ledger: { label: 'simple.setupSteps.ledger.label', hint: 'simple.setupSteps.ledger.hint' },
  bank: { label: 'simple.setupSteps.bank.label', hint: 'simple.setupSteps.bank.hint' },
  voucher: { label: 'simple.setupSteps.voucher.label', hint: 'simple.setupSteps.voucher.hint' },
  invoice: { label: 'simple.setupSteps.invoice.label', hint: 'simple.setupSteps.invoice.hint' },
  backup: { label: 'simple.setupSteps.backup.label', hint: 'simple.setupSteps.backup.hint' }
}

const cardCls = 'rounded-xl border border-line bg-panel p-panel shadow-elev-1'

/** UI overhaul: each task's icon; + Sale is the one filled (primary) button on Home (audit UX-15). */
const TASK_ICON: Record<string, string> = { sale: 'receipt', purchase: 'cart', 'money-in': 'in', 'money-out': 'out' } // i18n-technical: icon ids
const CMP08 = 'cmp08' // i18n-technical
const GSTR4 = 'gstr4' // i18n-technical

/**
 * WP 8.6: the simple Home — today's money in / out, who owes whom, cash and bank, GST due (regular
 * registrations), how the business is doing, the task buttons, what needs attention, what is
 * coming up and the setup checklist. Everything comes from ONE call (`simple:home`) whose figures
 * are the accountant screens' own services as on today; each figure's "Why?" sentence is a pure
 * function of those figures (shared/simple/explain.ts).
 */
export function SimpleHome(): React.JSX.Element {
  const t = useT()
  const today = todayISO()
  const homeQ = useQuery({
    queryKey: ['simple', 'home', today], // i18n-technical
    queryFn: () => api.simple.home(today)
  })
  const home = homeQ.data

  return (
    <Page data-testid="simple-home">
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="font-serif text-display font-semibold tracking-[-0.025em] text-ink">{t('simple.home.title')}</h1>
        <span className="text-small text-muted" data-testid="simple-home-date">
          {t('simple.home.asOn', { date: toPlainDate(today, t.lang) })}
        </span>
      </div>

      <AskBox />
      <Tasks />

      {homeQ.isError && (
        <section className={`${cardCls} mt-5`} data-testid="simple-home-error">
          <p className="text-detail text-ink">{t('simple.home.loadError')}</p>
          <Button className="mt-3" variant="secondary" size="sm" onClick={() => void homeQ.refetch()}>
            {t('common.tryAgain')}
          </Button>
        </section>
      )}
      {!home && !homeQ.isError && <HomeSkeleton />}
      {home && <HomeBody home={home} />}
      {/* WP 10.3: the first-run tour (once per company + user after setup; Help runs it again). */}
      <HomeTour />
    </Page>
  )
}

/** Phase 5 (skeletons, no layout shift): while `simple:home` loads, the tile grid HomeBody draws —
 *  the wide cash tile, four tiles, the profit row and the attention card — as placeholders of the
 *  tiles' usual size, so the page has its shape at once and the figures land in place. */
/** The grid HomeBody draws: the GST tile only for a registered business (composition gets its own
 *  tile), and the profit row's span follows (HomeBody `profitSpan`). */
function skeletonTileSpans(registration: string | undefined): string[] {
  const gstTile = registration !== 'unregistered' // i18n-technical: registration type
  return [
    'md:col-span-2 xl:row-span-2', // i18n-technical: cash and bank, the wide tile
    '', // money in today
    '', // money out today
    '', // customers owe you
    '', // you owe suppliers
    ...(gstTile ? [''] : []), // GST
    gstTile ? 'md:col-span-1 xl:col-span-3' : 'md:col-span-2 xl:col-span-1' // i18n-technical: profit
  ]
}

function HomeSkeleton(): React.JSX.Element {
  const registration = useSession((s) => s.info?.gstRegistrationType)
  return (
    <div aria-hidden="true" data-testid="simple-home-skeleton">
      <ul className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {skeletonTileSpans(registration).map((span, i) => (
          <li key={i} className={`${cardCls} flex min-h-[7.25rem] flex-col ${span}`}>
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="mt-3 h-6 w-1/2" />
            <Skeleton className="mt-auto h-3 w-1/4" />
          </li>
        ))}
      </ul>
      <section className={`${cardCls} mt-5 flex flex-col gap-3`}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-3 w-3/5" />
      </section>
    </div>
  )
}

/** WP 10.1: "Ask Total" — a search-style box that opens the assistant panel with the question. */
function AskBox(): React.JSX.Element {
  const t = useT()
  const [q, setQ] = useState('')
  const submit = (e: React.FormEvent): void => {
    e.preventDefault()
    const text = q.trim()
    if (!text) return
    const panel = useAssistantPanel.getState()
    panel.setSimpleView('ask') // i18n-technical
    panel.setOpen(true)
    useAskTotal.getState().ask(text)
    setQ('')
  }
  return (
    <form role="search" aria-label={t('assist.home.label')} onSubmit={submit} className="mb-4 flex gap-2" data-testid="simple-home-ask">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t('assist.home.placeholder')}
        aria-label={t('assist.home.label')}
        data-testid="simple-home-ask-input"
        className="min-w-0 flex-1 rounded-lg border border-line-strong/80 bg-panel px-3.5 py-2.5 text-body text-ink shadow-elev-1 transition-colors placeholder:text-muted hover:border-line-strong focus-visible:border-focus"
      />
      <Button type="submit" variant="primary" disabled={!q.trim()} data-testid="simple-home-ask-send">
        {t('assist.home.ask')}
      </Button>
    </form>
  )
}

function Tasks(): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  return (
    <nav aria-label={t('simple.home.tasks')} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {HOME_TASKS.map((task, i) => (
        <button
          key={task.id}
          type="button"
          data-testid={`simple-task-${task.id}`}
          onClick={() => nav.go(task.screen)}
          className={`t-btn flex min-h-14 items-center gap-3 rounded-xl border px-4 py-3 text-left text-lead font-semibold shadow-elev-1 ${
            i === 0
              ? 't-btn-primary border-primary bg-primary text-on-primary hover:bg-primary-hover'
              : 'border-line bg-panel text-ink hover:border-line-strong hover:shadow-elev-2'
          }`}
        >
          <span
            aria-hidden="true"
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${i === 0 ? 'bg-on-primary/15' : 'bg-amberbar/15 text-amber'}`}
          >
            <PlainIcon id={TASK_ICON[task.id] ?? 'plus'} />
          </span>
          {t(task.label) /* i18n-technical: keyed in homeTasks.ts */}
        </button>
      ))}
    </nav>
  )
}

function HomeBody({ home }: { home: SimpleHomeData }): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  const checklist = onboardingFromDashSetup(home.setup)
  const gstRegular = home.gst?.kind === 'regular' ? (home.gst as Extract<HomeGst, { kind: 'regular' }>) : null
  // Each link says what it opens, and opens that figure (same date, side, period).
  const link = (id: HomeReport, label: string): { label: string; onOpen: () => void } => ({ label, onOpen: () => nav.go(homeReportScreen(id, home)) })
  const links = {
    day: link('day', t('simple.home.link.day')), // i18n-technical
    receivables: link('receivables', t('simple.home.link.receivables')), // i18n-technical
    payables: link('payables', t('simple.home.link.payables')), // i18n-technical
    cash: link('cash', t('simple.home.link.cash')), // i18n-technical
    profit: link('profit', t('simple.home.link.profit')), // i18n-technical
    gst: link('gst', gstRegular ? gstLinkLabel(gstRegular, t) : '') // i18n-technical
  }
  const empty = isEmptyHome(home)
  const canSave = useCanWrite()
  // The profit sentence fills what its row leaves. With a GST tile: the cell beside it on two
  // columns, the whole row on three. Without one: the whole row on two columns, the one cell left
  // beside who-owes-whom on three. (Cash and bank spans two columns, so every row is full.)
  const profitSpan = gstRegular || home.gst?.kind === 'composition' ? 'md:col-span-1 xl:col-span-3' : 'md:col-span-2 xl:col-span-1'
  const backupsScreen = homeReportScreen('backups', home) // i18n-technical

  return (
    <>
      {home.gstAnswer === 'not_sure' && (
        <section className={`${cardCls} mt-5`} data-testid="simple-home-not-sure-gst">
          <h2 className="text-lead font-semibold text-ink">{t('simple.home.notSureGstTitle')}</h2>
          <p className="mt-1 text-detail text-muted">{t('simple.home.notSureGstHint')}</p>
        </section>
      )}

      <OpeningsHomeCard owed={{ receivables: home.receivables.total, payables: home.payables.total }} />
      <ApprovalsHomeCard />

      {empty && <EmptyHome checklist={checklist} />}

      {!empty && (
      <ul className="t-rise mt-5 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Tile
          id="cash"
          wide
          title={t('simple.home.cashAndBank')}
          paise={home.cash.total}
          why={cashWhy(home.cash, t)}
          link={links.cash}
        >
          {home.cash.accounts.length > 0 && <CashSplit accounts={home.cash.accounts} />}
        </Tile>
        <Tile
          id="money-in"
          title={t('simple.home.moneyInToday')}
          paise={home.moneyIn.amount}
          why={moneyInWhy(home.moneyIn, t)}
          link={links.day}
        />
        <Tile
          id="money-out"
          title={t('simple.home.moneyOutToday')}
          paise={home.moneyOut.amount}
          why={moneyOutWhy(home.moneyOut, t)}
          link={links.day}
        />
        <Tile
          id="receivables"
          title={t('simple.home.customersOwe')}
          paise={home.receivables.total}
          why={receivablesWhy(home.receivables, t)}
          link={links.receivables}
        />
        <Tile
          id="payables"
          title={t('simple.home.youOweSuppliers')}
          paise={home.payables.total}
          why={payablesWhy(home.payables, home.today, t)}
          link={links.payables}
        />
        {gstRegular && (
          <Tile
            id="gst"
            title={t('simple.home.gstTitle')}
            value={gstLine(gstRegular, home.today, t)}
            paise={gstRegular.row.payable}
            why={gstWhy(gstRegular, home.today, t)}
            link={links.gst}
            titleExtra={<CaCheck place="simple.home.gst" quarterly={gstRegular.filing === 'quarterly'} />}
          >
            {gstRegular.filing === 'quarterly' && (
              <p className="mt-2 text-hint text-muted" data-testid="simple-home-gst-quarterly">
                {t('simple.home.gstQuarterly')}
              </p>
            )}
            {gstRegular.pmt06 && gstRegular.pmt06.length > 0 && (
              <div className="mt-1">
                <Why
                  label={t('common.why')}
                  ariaLabel={t('simple.home.whyLabel', { what: t('simple.taxes.due.title') })}
                  sentence={pmt06Why(gstRegular.pmt06, home.today, t)}
                  link={links.gst}
                  testId="simple-why-pmt06"
                />
              </div>
            )}
          </Tile>
        )}
        {home.gst?.kind === 'composition' && (
          <li className={cardCls} data-testid="simple-tile-gst-composition">
            <div className="flex flex-wrap items-baseline">
              <h2 className="text-small font-medium text-muted">{t('simple.home.gstTitle')}</h2>
              <CaCheck place="simple.home.gstComposition" />
            </div>
            <p className="mt-2 text-detail text-ink">{t('simple.home.gstComposition')}</p>
            {home.gst.composition && (
              <div className="mt-2">
                <Why
                  label={t('common.why')}
                  ariaLabel={t('simple.home.whyLabel', { what: t('simple.home.gstTitle') })}
                  sentence={compositionDueWhy(CMP08, { composition: home.gst.composition, today: home.today }, t)}
                  link={link('gst', t('simple.why.link.taxes'))} // i18n-technical
                  testId="simple-why-gst-composition"
                >
                  <p className="text-small text-muted" data-testid="simple-why-gst-composition-gstr4">
                    {compositionDueWhy(GSTR4, { composition: home.gst.composition, today: home.today }, t)}
                  </p>
                </Why>
              </div>
            )}
          </li>
        )}
        {home.profitHidden ? (
          <li className={`${cardCls} ${profitSpan}`} data-testid="simple-tile-profit-hidden">
            <h2 className="text-small font-medium text-muted">{t('simple.home.profitTitle')}</h2>
            <p className="mt-2 text-detail text-muted">{t('simple.home.profitHidden')}</p>
          </li>
        ) : (
        <li className={`${cardCls} ${profitSpan}`} data-testid="simple-tile-profit" data-paise={home.profit.year.netProfit} data-month-paise={home.profit.month.netProfit}>
          <h2 className="text-small font-medium text-muted">{t('simple.home.profitTitle')}</h2>
          <p className="mt-2 text-lead text-ink" data-testid="simple-tile-profit-sentence">
            {profitSentence(home.profit, t)}
          </p>
          <div className="mt-2">
            <Why
              label={t('common.why')}
              ariaLabel={t('simple.home.whyLabel', { what: t('simple.home.profitTitle') })}
              sentence={homeProfitWhy(home.profit, t)}
              link={links.profit}
              testId="simple-why-profit"
            >
              <p className="text-small text-muted" data-testid="simple-why-profit-compare">
                {monthCompareWhy(home.profit, t)}
              </p>
            </Why>
          </div>
        </li>
        )}
      </ul>
      )}

      {home.backupCheck && !home.backupCheck.ok && (
        <section className={`${cardCls} mt-5 border-cr/50`} data-testid="simple-home-backup-check-failed">
          <p className="flex items-start gap-2 text-detail text-ink">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-cr" />
            {t('simple.home.backupCheckFailed')}
          </p>
          {canSave ? (
            <Button className="mt-2" size="sm" variant="secondary" onClick={() => nav.go(backupsScreen)}>
              {t('simple.home.backupNow')}
            </Button>
          ) : (
            <div className="mt-2">
              <ViewerBackupNote />
            </div>
          )}
        </section>
      )}

      {!empty && <Attention home={home} />}

      {home.backupCheck?.ok && (
        <p className="mt-4 text-small text-muted" data-testid="simple-home-backup-check">
          {t('simple.home.backupChecked', { days: daysAgo(home.backupCheck.checkedAt) })}
        </p>
      )}

      {(home.deadlines.length > 0 || home.backup.nudge) && (
        <section className={`${cardCls} mt-5`} data-testid="simple-home-coming-up">
          <h2 className="text-title font-semibold text-ink">{t('simple.home.deadlinesTitle')}</h2>
          <ul className="mt-2 flex flex-col gap-1">
            {home.deadlines.map((d) => {
              const target = deadlineScreen(d.kind)
              return (
                <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-detail text-ink">
                  <span data-testid={`simple-deadline-${d.kind}`}>{deadlineText(d, home.today, t)}</span>
                  <Why
                    label={t('common.why')}
                    ariaLabel={t('simple.home.whyLabel', { what: deadlineText(d, home.today, t) })}
                    sentence={deadlineWhy(d, home.today, t)}
                    link={target ? { label: d.kind === 'tds' ? t('simple.why.link.tds') : t('simple.why.link.payroll'), onOpen: () => nav.go(target) } : undefined}
                    testId={`simple-why-deadline-${d.kind}`}
                  />
                </li>
              )
            })}
          </ul>
          {home.backup.nudge && home.backup.days != null && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-md bg-panel2 px-3 py-2" data-testid="simple-home-backup-nudge">
              <p className="text-detail text-ink">{t('simple.home.backupNudge', { days: home.backup.days })}</p>
              {canSave ? (
                <Button size="sm" variant="secondary" data-testid="btn-home-backup-now" onClick={() => nav.go(backupsScreen)}>
                  {t('simple.home.backupNow')}
                </Button>
              ) : (
                <ViewerBackupNote />
              )}
            </div>
          )}
        </section>
      )}

      <Setup checklist={checklist} />
    </>
  )
}

/** Cash and bank, per account: a proportional bar (accounts above zero) over the account rows. */
function CashSplit({ accounts }: { accounts: SimpleHomeData['cash']['accounts'] }): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  const positive = accounts.filter((a) => a.balance > 0)
  const total = positive.reduce((sum, a) => sum + a.balance, 0)
  // The cash drawer is amber; banks are shades of ink (decorative — the rows below say it).
  const tone = (i: number, kind: string): string => (kind === 'cash' ? 'bg-amberbar' : i % 2 === 0 ? 'bg-ink/70' : 'bg-ink/35')
  return (
    <>
      {positive.length > 1 && total > 0 && (
        <div aria-hidden="true" className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full" data-testid="simple-home-cash-bar">
          {positive.map((a, i) => (
            <span key={a.ledgerId} className={`h-full rounded-full ${tone(i, a.kind)}`} style={{ flexGrow: a.balance, flexBasis: 0 }} />
          ))}
        </div>
      )}
      <ul className="mt-3 flex flex-col divide-y divide-line" data-testid="simple-home-accounts">
        {accounts.map((a) => (
          <li key={a.ledgerId}>
            <button
              type="button"
              data-testid={`simple-home-account-${a.ledgerId}`}
              data-paise={a.balance}
              onClick={() => nav.go(accountScreen(a.ledgerId))}
              className="group flex w-full items-baseline justify-between gap-3 rounded-sm py-1.5 text-left text-detail"
            >
              <span className="min-w-0 truncate text-muted group-hover:text-ink">{a.kind === 'cash' ? t('simple.home.cashInHand') : a.name}</span>
              <span className={`num font-medium ${a.balance < 0 ? 'text-cr' : 'text-ink'}`}>{money(a.balance)}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}

function Tile({
  id,
  title,
  paise,
  value,
  why,
  link,
  wide = false,
  titleExtra,
  children
}: {
  id: string
  title: string
  paise: number
  /** The wide headline tile (Cash and bank): two columns, the bigger figure. */
  wide?: boolean
  /** Shown instead of the amount (the GST tile's "₹Z by 20 Nov"). */
  value?: string
  /** Beside the title (Phase 2b: a "Check with your CA" badge). */
  titleExtra?: ReactNode
  why: string
  link: { label: string; onOpen: () => void }
  children?: ReactNode
}): React.JSX.Element {
  const t = useT()
  return (
    <li className={`${cardCls} flex flex-col ${wide ? 'md:col-span-2 xl:row-span-2' : ''}`} data-testid={`simple-tile-${id}`} data-paise={paise}>
      <div className="flex flex-wrap items-baseline">
        <h2 className="text-small font-medium text-muted">{title}</h2>
        {titleExtra}
      </div>
      <p
        className={`num mt-1 font-semibold tracking-[-0.02em] ${wide ? 'text-display' : 'text-heading'} ${paise < 0 ? 'text-cr' : 'text-ink'}`}
        data-testid={`simple-tile-${id}-value`}
      >
        {value ?? money(paise)}
      </p>
      {children}
      <div className="mt-auto pt-2">
        <Why
          label={t('common.why')}
          ariaLabel={t('simple.home.whyLabel', { what: title })}
          sentence={why}
          link={link}
          testId={`simple-why-${id}`}
        />
      </div>
    </li>
  )
}

function Attention({ home }: { home: SimpleHomeData }): React.JSX.Element | null {
  const t = useT()
  const nav = useNav()
  // The slow half (close checklist + anomaly scan) comes after Home shows; the overdue rows are
  // the tiles' own figures, so they show at once and never contradict them.
  const attentionQ = useQuery({
    queryKey: ['simple', 'homeAttention', home.today], // i18n-technical
    queryFn: () => api.simple.homeAttention(home.today)
  })
  const attention = attentionQ.data
  const period = attention?.period ?? ''
  const items = homeAttentionRows(owedAttention(home.receivables, home.payables), attention?.items ?? [])
  if (items.length === 0) return null
  return (
    <section className={`${cardCls} mt-5`} data-testid="simple-home-attention" data-loading={attentionQ.isLoading ? 'true' : 'false'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title font-semibold text-ink">{t('simple.home.needsAttention')}</h2>
        <span className="text-small text-muted" data-testid="simple-home-attention-count">
          {attentionQ.isLoading ? t('simple.home.attentionLoading') : t('simple.home.attentionCount', { count: items.length })}
        </span>
      </div>
      <ul className="mt-2 flex flex-col">
        {items.slice(0, 3).map((item) => (
          <li key={`${item.source}-${item.key}`} className="border-b border-line/50 last:border-b-0">
            <button
              type="button"
              data-testid={`simple-attention-${item.source}-${item.key}`}
              onClick={() => nav.go(attentionScreen(item, period))}
              className="-mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-panel2 focus-visible:bg-panel2"
            >
              <span className="flex min-w-0 items-start gap-2">
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.level === 'high' ? 'bg-cr' : 'bg-amber'}`} />
                <span className="text-detail text-ink">{attentionText(item, period, t)}</span>
              </span>
              <span className="t-link shrink-0 text-hint font-medium">{t('simple.home.attentionOpen')} →</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > 3 && (
        <button type="button" data-testid="simple-home-attention-all" className="t-link mt-2 text-hint font-medium" onClick={() => nav.go(attentionScreen(items[3]!, period))}>
          {t('simple.home.attentionSeeAll', { count: items.length })}
        </button>
      )}
      {attention?.anomaliesSkipped && (
        <p className="mt-2 text-hint text-muted" data-testid="simple-home-attention-capped">
          {t('simple.home.attentionCapped')}
        </p>
      )}
    </section>
  )
}

/** A company with nothing recorded: one card. Audit A7 / UX-15: "Make your first bill" is its main
 *  action; the next setup step (business details first) is the second. A continuing business that
 *  has not entered its day-one figures yet sees only the openings card (WP 8.7, above) — that is
 *  its first step, never offered twice. */
function EmptyHome({ checklist }: { checklist: OnboardingChecklist }): React.JSX.Element | null {
  const t = useT()
  const nav = useNav()
  const next = checklist.steps.find((s) => !s.done && !s.skipped && STEP_LABEL[s.id] && s.id !== 'voucher')
  // Same query (and cache) as OpeningsHomeCard.
  const { data: openings } = useQuery({ queryKey: ['openings'], queryFn: api.openings.get }) // i18n-technical
  if (openings && !openings.appliedAt && openings.startedFresh === false) return null
  return (
    <section className={`${cardCls} mt-5`} data-testid="simple-home-empty">
      <h2 className="text-title font-semibold text-ink">{t('simple.home.emptyTitle')}</h2>
      <p className="mt-1 text-detail text-muted">{t('simple.home.emptyBody')}</p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="primary" data-testid="simple-home-empty-first-bill" onClick={() => nav.go(HOME_TASKS[0]!.screen)}>
          {t('simple.setupSteps.voucher.label')}
        </Button>
        {next && (
          <Button variant="secondary" data-testid="simple-home-empty-next" onClick={() => nav.go(homeSetupScreen(checklist, next.id))}>
            {t(STEP_LABEL[next.id]!.label) /* i18n-technical: keyed by step id */}
          </Button>
        )}
      </div>
    </section>
  )
}

function Setup({ checklist: all }: { checklist: OnboardingChecklist }): React.JSX.Element {
  const t = useT()
  const nav = useNav()
  // A step that does not apply (the GST number for an unregistered business) is left out — never
  // shown ticked as if the user had done it. The step logic stays in onboarding.ts.
  const steps = all.steps.filter((s) => !s.skipped)
  const doneCount = steps.filter((s) => s.done).length
  const checklist = { ...all, steps, doneCount, total: steps.length, complete: doneCount === steps.length }
  return (
    <section data-testid="simple-home-setup" className={`${cardCls} mt-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-title font-semibold text-ink">{t('simple.home.setupTitle')}</h2>
        <span className="num text-small text-muted" data-testid="simple-home-setup-progress">
          {t('simple.home.setupProgress', { done: checklist.doneCount, total: checklist.total })}
        </span>
      </div>
      <div
        role="progressbar"
        aria-label={t('simple.home.setupTitle')}
        aria-valuemin={0}
        aria-valuemax={checklist.total}
        aria-valuenow={checklist.doneCount}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel2"
      >
        <div className="h-full rounded-full bg-amberbar" style={{ width: `${checklist.total ? Math.round((checklist.doneCount / checklist.total) * 100) : 100}%` }} />
      </div>
      {checklist.complete ? (
        <p className="mt-3 text-detail text-muted">{t('simple.home.setupDone')}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-1 md:grid-cols-2">
          {checklist.steps.map((step) => {
            const keys = STEP_LABEL[step.id]
            if (!keys) return null
            const label = t(keys.label) // i18n-technical: keyed by step id above
            const hint = t(keys.hint) // i18n-technical: keyed by step id above
            const body = (
              <>
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-micro ${
                    step.done ? 'border-success bg-success-soft text-success' : 'border-line-strong text-transparent'
                  }`}
                >
                  ✓
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-detail ${step.done ? 'text-muted line-through decoration-line-strong' : 'text-ink'}`}>
                    {label}
                    <span className="sr-only"> {step.done ? t('simple.home.stepDone') : t('simple.home.stepToDo')}</span>
                  </span>
                  {!step.done && <span className="block text-hint text-muted">{hint}</span>}
                </span>
              </>
            )
            return (
              <li key={step.id} className="min-w-0">
                {step.done ? (
                  <div className="flex items-start gap-3 border-b border-line/50 px-4 py-2" data-testid={`simple-setup-${step.id}`} data-done="true">
                    {body}
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid={`simple-setup-${step.id}`}
                    data-done="false"
                    onClick={() => nav.go(homeSetupScreen(checklist, step.id))}
                    className="flex w-full items-start gap-3 border-b border-line/50 px-4 py-2 text-left hover:bg-panel2 focus-visible:bg-panel2"
                  >
                    {body}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
