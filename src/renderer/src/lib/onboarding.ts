import type { OnboardingChecklist, OnboardingTarget } from '@shared/onboarding'
import type { Screen } from '../state/stores'

const TARGETS: Record<OnboardingTarget, Screen> = {
  'company-info': { name: 'company-info' },
  masters: { name: 'masters', tab: 'ledgers' },
  'voucher-entry': { name: 'voucher-entry' },
  'settings-backups': { name: 'settings', tab: 'backups' },
  'settings-invoice': { name: 'settings', tab: 'invoice' }
}

/** Where a checklist step's action navigates. */
export function onboardingScreen(checklist: OnboardingChecklist, stepId: string): Screen {
  const step = checklist.steps.find((s) => s.id === stepId)
  return step ? TARGETS[step.target] : { name: 'gateway' }
}
