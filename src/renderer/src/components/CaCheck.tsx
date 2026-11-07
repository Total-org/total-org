import { useMemo } from 'react'
import { caPointKey, caPointsAt, type CaContext, type CaPlace } from '@shared/caCheck'
import { translator, type MessageKey } from '@shared/i18n'
import { useT } from '../lib/i18n'
import { CaCheckBadge } from './kit/CaCheckBadge'

const ENGLISH = translator('en')

/**
 * Phase 2b — the "Check with your CA" badge for one place (shared/caCheck.ts `CA_PLACES`). It
 * shows the registry's points for that place and context (a quarterly filer, the bill's date …)
 * and renders nothing when none applies. Simple places (`simple.*`) speak the user's language
 * through t(); accountant places keep their English, like the rest of those screens.
 */
export function CaCheck({ place, testId, quarterly, date }: { place: CaPlace; testId?: string } & CaContext): React.JSX.Element | null {
  const userT = useT()
  const t = place.startsWith('simple.') ? userT : ENGLISH // i18n-technical
  const points = useMemo(() => caPointsAt(place, { quarterly, date }), [place, quarterly, date])
  if (points.length === 0) return null
  return (
    <CaCheckBadge
      label={t('common.caCheck.badge')}
      ariaLabel={t('common.caCheck.label')}
      intro={t('common.caCheck.intro')}
      points={points.map((p) => ({ id: p.id, sentence: t(caPointKey(p.id) as MessageKey), rule: t('common.caCheck.about', { rule: p.rule }) }))}
      testId={testId ?? `ca-check-${place.replace(/\./g, '-')}`}
    />
  )
}
