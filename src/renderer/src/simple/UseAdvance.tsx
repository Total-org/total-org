import { formatPaise } from '@shared/money'
import { useT } from '../lib/i18n'

/**
 * R1 (FIG-G-1) — "Use what they paid ahead (₹X)" on Make a bill / Record a purchase (`supplier`): shown
 * while the party holds open credits the bill can use (`simple:money:credits`, the list simple:post
 * takes them from), ticked by default; unticked when the money was for another order. While ticked
 * it says what is left to pay, which "Paid how?" then works on. The figures come from the screen:
 * `held` = what they hold, `left` = the bill less what of it is used (sellAdvance / buyAdvance).
 */
export function UseAdvance({ supplier = false, held, left, checked, onChange }: {
  supplier?: boolean
  held: number
  left: number
  checked: boolean
  onChange: (on: boolean) => void
}): React.JSX.Element {
  const t = useT()
  const amount = formatPaise(held, { symbol: true })
  const label = supplier ? t('simple.buy.useAdvance', { amount }) : t('simple.sell.useAdvance', { amount })
  const leftVars = { amount: formatPaise(left, { symbol: true }) }
  const tid = supplier ? 'buy-advance' : 'sell-advance' // i18n-technical: test ids
  return (
    <section className="rounded-xl border border-line bg-panel p-panel shadow-elev-1" aria-label={label} data-testid={tid}>
      <label className="flex items-center gap-2 text-body text-ink">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={`${tid}-use`} />
        {label}
      </label>
      <p className="mt-1 text-small text-muted">{supplier ? t('simple.buy.useAdvanceHint') : t('simple.sell.useAdvanceHint')}</p>
      {checked && (
        <p className="mt-2 text-detail text-ink" data-testid={`${tid}-left`} data-paise={left}>
          {supplier ? t('simple.buy.leftToPay', leftVars) : t('simple.sell.leftToPay', leftVars)}
        </p>
      )}
    </section>
  )
}
