// Phase 2c: the HSN field's words in the reader's language for simple mode (components/HsnInput
// prints English by default — the accountant screens).
import { useMemo } from 'react'
import { HSN_SIX_DIGITS_ABOVE_TURNOVER_PAISE } from '@shared/gst/hsn'
import type { Translate } from '@shared/i18n'
import { formatPaise } from '@shared/money'
import type { HsnLabels } from '../components/HsnInput'
import { useT } from '../lib/i18n'

export function simpleHsnLabels(t: Translate): HsnLabels {
  return {
    loading: t('simple.hsn.loading'),
    list: t('simple.hsn.list'),
    noMatch: (query) => t('simple.hsn.noMatch', { query }),
    rateNote: t('simple.hsn.rateNote'),
    notInList: (code) => t('simple.hsn.notInList', { code }),
    fourDigits: t('simple.hsn.fourDigits', { limit: formatPaise(HSN_SIX_DIGITS_ABOVE_TURNOVER_PAISE, { symbol: true }) }),
    eightDigits: t('simple.hsn.eightDigits')
  }
}

export function useSimpleHsnLabels(): HsnLabels {
  const t = useT()
  return useMemo(() => simpleHsnLabels(t), [t])
}
