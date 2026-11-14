import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { translator, type Translate } from '@shared/i18n'
import { mapError, type CaughtError } from '@shared/errors'
import { api } from '../../lib/client'
import { counterApi } from '../../lib/pricingClient'
import { useT } from '../../lib/i18n'
import { useMode } from '../../lib/mode'
import { useCanWrite } from '../../simple/ViewerNote'

const ENGLISH = translator('en')
const TEMPLATES_KEY = ['printTemplates'] // i18n-technical: the designer's key, so its defaults follow
const COUNTER_KEY = ['counterConfig'] // i18n-technical

/** The two built-in till receipts (PROD-11). */
export const RECEIPT_IDS = { 80: 'receipt-80mm', 58: 'receipt-58mm' } as const // i18n-technical
export type ReceiptWidth = keyof typeof RECEIPT_IDS
const widthOf = (id: string | undefined): ReceiptWidth | null => (id === RECEIPT_IDS[58] ? 58 : id === RECEIPT_IDS[80] ? 80 : null)

/**
 * PROD-11 — Settings → Bills & printing: "How do you print your bills?" — on A4 paper, or on a
 * receipt printer 3-inch (80 mm) / 2-inch (58 mm). Written through the existing channels only:
 * the sales bills' default print template (`template:setDefault`, what Make a bill / the save
 * card / the sales list print with) and the counter's receipt (`counter:setConfig` templateId).
 * A receipt width also moves the counter's receipt; "A4 paper" leaves the counter's receipt as it
 * is (a till prints receipts) and puts sales back on Classic only when they printed a receipt.
 * Plain words in a simple-mode company, English in the full app; viewers see it read-only.
 */
export function ReceiptPaperSetting(): React.JSX.Element {
  const simple = useMode() === 'simple'
  const userT = useT()
  const t: Translate = simple ? userT : ENGLISH
  const canWrite = useCanWrite()
  const queryClient = useQueryClient()
  const { data: list } = useQuery({ queryKey: TEMPLATES_KEY, queryFn: api.templates.list })
  const { data: counter } = useQuery({ queryKey: COUNTER_KEY, queryFn: counterApi.config })
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const salesWidth = widthOf(list?.defaults.sales)
  const current: 'a4' | ReceiptWidth | null = list ? (salesWidth ?? 'a4') : null // i18n-technical
  const counterWidth = widthOf(counter?.config.templateId)

  const choose = async (choice: 'a4' | ReceiptWidth): Promise<void> => {
    if (!list || !counter || choice === current) return
    setBusy(true)
    setNote(null)
    setError(null)
    try {
      if (choice === 'a4') {
        // i18n-technical: the Classic built-in
        if (salesWidth != null) await api.templates.setDefault('sales', 'classic')
      } else {
        const id = RECEIPT_IDS[choice]
        await api.templates.setDefault('sales', id)
        if (counter.config.templateId !== id) await counterApi.setConfig({ ...counter.config, templateId: id })
      }
      setNote(t('simple.receiptPaper.saved'))
    } catch (err) {
      setError(mapError(err as CaughtError, { simple, t }).general ?? t('errors.generic'))
    } finally {
      await queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY })
      await queryClient.invalidateQueries({ queryKey: COUNTER_KEY })
      setBusy(false)
    }
  }

  const options: { value: 'a4' | ReceiptWidth; label: string; hint: string }[] = [
    { value: 'a4', label: t('simple.receiptPaper.a4'), hint: t('simple.receiptPaper.a4Hint') },
    { value: 80, label: t('simple.receiptPaper.w80'), hint: t('simple.receiptPaper.w80Hint') },
    { value: 58, label: t('simple.receiptPaper.w58'), hint: t('simple.receiptPaper.w58Hint') }
  ]
  return (
    <section className="mb-6 rounded-xl border border-line bg-panel px-4 py-3" aria-labelledby="receipt-paper-title" data-testid="receipt-paper-setting">
      <h2 id="receipt-paper-title" className="text-body font-semibold text-ink">{t('simple.receiptPaper.title')}</h2>
      <p className="mt-1 text-detail text-muted">{t('simple.receiptPaper.intro')}</p>
      <div role="radiogroup" aria-labelledby="receipt-paper-title" className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-3">
        {options.map((o) => {
          const on = current === o.value
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={on}
              data-testid={`receipt-paper-${o.value}`}
              disabled={!canWrite || busy || current == null || counter == null}
              onClick={() => void choose(o.value)}
              className={`rounded-md border px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-amber/70 ${
                on ? 'border-amber bg-amberbar/15' : 'border-line bg-panel hover:border-amber/60'
              }`}
            >
              <span className={`block text-detail text-ink ${on ? 'font-semibold' : ''}`}>{o.label}</span>
              <span className="mt-0.5 block text-small text-muted">{o.hint}</span>
            </button>
          )
        })}
      </div>
      {!simple && current === 'a4' && counterWidth != null && (
        <p className="mt-2 text-small text-muted" data-testid="receipt-paper-counter">
          {t(counterWidth === 58 ? 'simple.receiptPaper.counter58' : 'simple.receiptPaper.counter80')}
        </p>
      )}
      {!canWrite && <p className="mt-2 text-small text-muted">{t('simple.receiptPaper.viewerOnly')}</p>}
      {note && (
        <p role="status" className="mt-1 text-detail text-success" data-testid="receipt-paper-note">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-detail text-danger" data-testid="receipt-paper-error">
          {error}
        </p>
      )}
    </section>
  )
}
