'use server'

import { headers } from 'next/headers'
import { clientIp, ipKey, normaliseEmail } from '@/lib/waitlist'
import { addToWaitlist, waitlistEnabled, withinRateLimit } from '@/lib/waitlistStore'

export interface WaitlistState {
  status: 'idle' | 'joined' | 'invalid' | 'limited' | 'closed' | 'failed'
  /** The address as typed, so the box keeps it after an error. */
  email?: string
}

/** The landing page's form. Same answer for a new and a repeated address (no list probing). */
export async function joinWaitlist(_prev: WaitlistState, form: FormData): Promise<WaitlistState> {
  const typed = String(form.get('email') ?? '').slice(0, 300)
  // Honeypot: people never see this box; bots fill it. Answer as if it worked, store nothing.
  if (String(form.get('company_website') ?? '') !== '') return { status: 'joined' }

  const email = normaliseEmail(typed)
  if (!email) return { status: 'invalid', email: typed }
  if (!waitlistEnabled()) return { status: 'closed', email: typed }

  const h = await headers()
  const salt = process.env.WAITLIST_SALT ?? process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN ?? ''
  try {
    if (!(await withinRateLimit(ipKey(clientIp(h.get('x-forwarded-for'), h.get('x-real-ip')), salt)))) {
      return { status: 'limited', email: typed }
    }
    await addToWaitlist(email)
    return { status: 'joined' }
  } catch (err) {
    console.error('waitlist:', err instanceof Error ? err.message : String(err))
    return { status: 'failed', email: typed }
  }
}
