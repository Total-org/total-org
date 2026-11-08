import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/components/SiteNav'
import { RATE_WINDOW_S } from '@/lib/waitlist'
import { DELETE_LIST_WITHIN_DAYS, PRIVACY_CONTACT, PRIVACY_UPDATED, REMOVE_WITHIN_DAYS } from '@/lib/privacy'

export const metadata: Metadata = {
  title: 'Privacy — Total',
  description: 'What this website keeps about you (only your e-mail, if you join the 1.0 waitlist), why, for how long, and how to have it removed.'
}

export default function PrivacyPage(): React.JSX.Element {
  const mail = `mailto:${PRIVACY_CONTACT}`
  return (
    <>
      <SiteNav />
      <div className="wrap">
        <section className="docs-content privacy">
          <h1 className="serif">Privacy</h1>
          <p className="sub">
            What this website keeps about you, why, for how long, and how to have it removed. Last changed {PRIVACY_UPDATED}.
          </p>

          <h2>The Total app</h2>
          <p>
            Total works offline. Your books stay in a folder on your own computer; the app does not send them to us or to
            anyone else. This page is about the website, irminflow.com.
          </p>

          <h2>The 1.0 waitlist</h2>
          <p>If you join the waitlist, we keep exactly two things:</p>
          <ul>
            <li>your e-mail address, and</li>
            <li>the date and time you joined.</li>
          </ul>
          <p>
            Nothing else: no name, no phone number, no cookies, no tracking or analytics. We use the address for one thing —
            to write to you once, when Total 1.0 is out. We never sell it, share it or use it for anything else.
          </p>
          <p>
            The list is stored in an Upstash database, through Vercel, the company that hosts this website. They keep it for
            us and do not use it themselves.
          </p>

          <h2>How long we keep it</h2>
          <p>
            Until the 1.0 e-mail has gone out. Within {DELETE_LIST_WITHIN_DAYS} days after that, the whole list is deleted.
          </p>

          <h2>Being removed</h2>
          <p>
            Write to <a href={mail}>{PRIVACY_CONTACT}</a> from the address you signed up with (or tell us which address it
            is) and we delete it within {REMOVE_WITHIN_DAYS} days and write back to say it is done. You can also ask what we
            hold about you, or ask us to correct it, the same way — at any time, and for free.
          </p>

          <h2>Stopping floods of sign-ups</h2>
          <p>
            To stop one machine from filling the list, the site counts sign-up tries per network connection for{' '}
            {RATE_WINDOW_S / 60} minutes. It counts them under a scrambled, one-way code made from your network address,
            never the address itself, and the counters delete themselves after {(RATE_WINDOW_S * 2) / 60} minutes.
          </p>
          <p>
            Like every website host, Vercel keeps technical logs of the requests it serves (which include network
            addresses) to run and protect its service, under{' '}
            <a href="https://vercel.com/legal/privacy-policy">its own privacy policy</a>.
          </p>

          <h2>Update checks from the app</h2>
          <p>
            An installed Total asks this site whether a newer version exists (unless you turned that off in the app). That
            request carries nothing about you or your books beyond what any web request does (see above), and we do not
            store it.
          </p>

          <h2>Questions</h2>
          <p>
            Write to <a href={mail}>{PRIVACY_CONTACT}</a>. <Link href="/">Back to the home page</Link>.
          </p>
        </section>
      </div>
    </>
  )
}
