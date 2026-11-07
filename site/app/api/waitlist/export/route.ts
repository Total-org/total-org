import { toCsv, tokenMatches } from '@/lib/waitlist'
import { listWaitlist, waitlistEnabled } from '@/lib/waitlistStore'

/**
 * The owner's export of the waitlist as CSV:
 *   curl -H "Authorization: Bearer $WAITLIST_ADMIN_TOKEN" https://irminflow.com/api/waitlist/export -o waitlist.csv
 * WAITLIST_ADMIN_TOKEN (24+ characters) lives only in Vercel's env vars. Without it, with a
 * wrong one, or with no store, the route answers 404 — it does not say it exists.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = request.headers.get('authorization')
  const given = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : null
  const noStore = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
  if (!tokenMatches(given, process.env.WAITLIST_ADMIN_TOKEN) || !waitlistEnabled()) {
    return new Response('Not found\n', { status: 404, headers: noStore })
  }
  try {
    const csv = toCsv(await listWaitlist())
    return new Response(csv, {
      headers: {
        ...noStore,
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="waitlist-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    })
  } catch (err) {
    console.error('waitlist export:', err instanceof Error ? err.message : String(err))
    return new Response('The waitlist store did not answer. Try again in a minute.\n', { status: 502, headers: noStore })
  }
}
