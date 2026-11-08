import { removalRequest, tokenMatches } from '@/lib/waitlist'
import { clearWaitlist, removeFromWaitlist, waitlistEnabled } from '@/lib/waitlistStore'

/**
 * The owner's way to honour a removal request (/privacy promises it within 7 days):
 *   curl -X POST -H "Authorization: Bearer $WAITLIST_ADMIN_TOKEN" -H 'Content-Type: application/json' \
 *     -d '{"email":"someone@example.com"}' https://irminflow.com/api/waitlist/remove
 * and, after the 1.0 e-mail, the whole list:
 *     -d '{"all":true,"confirm":"delete the whole waitlist"}'
 * Same guard as the export: without the token (or with no store) it answers 404.
 */
export async function POST(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')
  const given = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
  if (!tokenMatches(given, process.env.WAITLIST_ADMIN_TOKEN) || !waitlistEnabled()) {
    return new Response('Not found\n', { status: 404, headers: noStore })
  }
  let body: unknown
  try {
    body = JSON.parse((await request.text()).slice(0, 2000))
  } catch {
    body = null
  }
  const req = removalRequest(body)
  if (!req) {
    return Response.json({ error: 'Send {"email": "…"} or {"all": true, "confirm": "delete the whole waitlist"}.' }, { status: 400, headers: noStore })
  }
  try {
    if ('all' in req) return Response.json({ deleted: await clearWaitlist() }, { headers: noStore })
    return Response.json({ removed: await removeFromWaitlist(req.email) }, { headers: noStore })
  } catch (err) {
    console.error('waitlist remove:', err instanceof Error ? err.message : String(err))
    return Response.json({ error: 'The waitlist store did not answer. Try again in a minute.' }, { status: 502, headers: noStore })
  }
}
