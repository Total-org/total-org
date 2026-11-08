/**
 * What the waitlist keeps and for how long — the ONE source for the notice beside the form
 * (components/WaitlistForm.tsx) and the /privacy page, so the two can never say different things.
 * Changing what is stored (lib/waitlistStore.ts) means changing these words in the same PR.
 */
export const PRIVACY_CONTACT = 'total@irminflow.com'
/** Days after a removal request (by e-mail) within which the address is deleted. */
export const REMOVE_WITHIN_DAYS = 7
/** Days after the 1.0 e-mail within which the whole list is deleted. */
export const DELETE_LIST_WITHIN_DAYS = 30
export const PRIVACY_UPDATED = '8 November 2026'
