import Image, { getImageProps } from 'next/image'
import Link from 'next/link'
import { IBM_Plex_Sans_Devanagari } from 'next/font/google'
import { latestRelease, RELEASES_PAGE, GITHUB_REPO } from '@/lib/release'
import { waitlistEnabled } from '@/lib/waitlistStore'
import WaitlistForm from '@/components/WaitlistForm'
import ModeSwitch from '@/components/ModeSwitch'
import homeLight from '@/public/shots/home-light.png'
import homeDark from '@/public/shots/home-dark.png'
import homeHindi from '@/public/shots/home-hindi.png'
import billLight from '@/public/shots/bill-light.png'
import accountantLight from '@/public/shots/accountant-light.png'
import taxesLight from '@/public/shots/taxes-light.png'
import gstr1Light from '@/public/shots/gstr1-light.png'
import s from './home.module.css'

const devanagari = IBM_Plex_Sans_Devanagari({ subsets: ['devanagari'], weight: ['500'], preload: false, display: 'swap' })

const GITHUB = `https://github.com/${GITHUB_REPO}`

/** The hero shot: the light screenshot, or the dark one when the visitor's system is dark. */
function HeroShot(): React.JSX.Element {
  const common = { alt: '', sizes: '(max-width: 1240px) 100vw, 1200px', priority: true } as const
  const { props: light } = getImageProps({ ...common, src: homeLight })
  const {
    props: { srcSet: darkSet }
  } = getImageProps({ ...common, src: homeDark })
  return (
    <picture>
      <source media="(prefers-color-scheme: dark)" srcSet={darkSet} sizes={common.sizes} />
      <img
        {...light}
        alt="Total's Home screen in simple mode: Sale, Purchase, Money in and Money out buttons above today's cash and bank, who owes you, what you owe suppliers and the GST to pay"
      />
    </picture>
  )
}

export default async function Home(): Promise<React.JSX.Element> {
  const release = await latestRelease()
  const enabled = waitlistEnabled()
  const releasesUrl = release?.htmlUrl ?? RELEASES_PAGE

  return (
    <div className={s.page}>
      <a href="#main" className={s.skip}>
        Skip to content
      </a>
      <header className={s.nav}>
        <div className={s.navRow}>
          <Link href="/" className={s.brand} aria-label="Total, home">
            <Image src="/icon-64.png" alt="" width={28} height={28} />
            <span>Total</span>
          </Link>
          <nav aria-label="Site" className={s.navLinks}>
            <Link href="/docs">Docs</Link>
            <Link href="/compare">Compare</Link>
            <Link href="/changelog">Changelog</Link>
            <a href={GITHUB}>GitHub</a>
          </nav>
          <a href="#waitlist" className={s.navCta}>
            {enabled ? 'Join the waitlist' : 'Hear about 1.0'}
          </a>
        </div>
      </header>

      <main id="main">
        <section className={s.hero} aria-labelledby="hero-title">
          <h1 id="hero-title" className={s.headline}>
            Your accounts, <span className={s.line}>on your own computer.</span>
          </h1>
          <div className={s.heroText}>
            <p className={`${s.hindi} ${devanagari.className}`} lang="hi">
              आपका हिसाब, आपके कंप्यूटर पर।
            </p>
            <p className={s.lede}>
              Total is accounting software for Indian shops and the CAs who look after them: bills, GST returns, stock
              and the bank, in plain words or the full accountant view. It works without the internet, and your books
              stay in a folder on your computer.
            </p>
          </div>
          <div className={s.heroForm} id="waitlist">
            <h2 className={s.formTitle}>Hear when 1.0 is ready</h2>
            <WaitlistForm id="hero" enabled={enabled} releasesUrl={releasesUrl} />
            <p className={s.tryNow}>
              Want to try it now? Download the current build for{' '}
              <a href="/api/download?platform=mac">macOS</a> or <a href="/api/download?platform=win">Windows</a> (preview)
              {release ? `, version ${release.version}` : ''}, or see <a href={releasesUrl}>every release on GitHub</a>.
            </p>
          </div>
        </section>

        <figure className={s.heroShot}>
          <div className={s.frame}>
            <HeroShot />
          </div>
          <figcaption className={s.caption}>
            Home in simple mode, on the sample business that comes with the app. Every figure has a “Why?” that says
            where it came from.
          </figcaption>
        </figure>

        <section className={s.section} aria-labelledby="modes-title">
          <h2 id="modes-title" className={s.h2}>
            Plain words for the shop. The full books for your CA.
          </h2>
          <p className={s.sub}>Both look at the same books. Switch any screen with one click.</p>
          <ModeSwitch
            panels={[
              {
                key: 'shop',
                label: 'Shop owner',
                body: (
                  <>
                    <h3 className={s.h3}>Simple mode</h3>
                    <p>
                      Make a bill, record a purchase, see who owes you and what you owe. No ledgers or vouchers to learn:
                      the screens ask everyday questions, like “Paid how?”, and do the bookkeeping behind them.
                    </p>
                    <ul className={s.list}>
                      <li>Bills with GST worked out as you type, printed or shared as a PDF</li>
                      <li>Money in and out, bank statements matched line by line</li>
                      <li>Reminders for late payers, written for WhatsApp or SMS</li>
                    </ul>
                  </>
                ),
                shot: (
                  <Image
                    src={billLight}
                    alt="Make a bill: two products with their GST rates, paid by UPI, and a one-line summary of the bill above the Save button"
                    sizes="(max-width: 900px) 100vw, 760px"
                    className={s.shotImg}
                  />
                )
              },
              {
                key: 'ca',
                label: 'Accountant',
                body: (
                  <>
                    <h3 className={s.h3}>The accountant view</h3>
                    <p>
                      The complete double-entry books, with the keys Tally users already know (F4 to F9 for entries).
                      Trial balance, profit and loss, balance sheet, registers, ageing, bank reconciliation, stock and
                      payroll, with an audit trail on every change.
                    </p>
                    <ul className={s.list}>
                      <li>Every report is worked out from the entries, so nothing drifts</li>
                      <li>Roles and sign-in for the people who share a computer</li>
                      <li>Export to Excel, and a pack of reports to hand your CA</li>
                    </ul>
                  </>
                ),
                shot: (
                  <Image
                    src={accountantLight}
                    alt="The accountant dashboard: cash and bank, receivables, payables, monthly sales and purchases, ageing, top customers and GST compliance"
                    sizes="(max-width: 900px) 100vw, 760px"
                    className={s.shotImg}
                  />
                )
              }
            ]}
          />
        </section>

        <section className={`${s.section} ${s.private}`} aria-labelledby="private-title">
          <div className={s.privateText}>
            <h2 id="private-title" className={s.h2}>
              Your books stay with you.
            </h2>
            <p className={s.sub}>
              Each business is a file in a folder on your computer. There is no account to make and no copy in anyone’s
              cloud.
            </p>
          </div>
          <dl className={s.facts}>
            <div>
              <dt>Works offline</dt>
              <dd>Bills, returns and reports are all worked out on your computer. A power cut or a bad connection stops nothing.</dd>
            </div>
            <div>
              <dt>Nothing leaves unless you say so</dt>
              <dd>
                The AI helper and live e-invoice filing are off until you turn them on and add your own keys. Updates
                download only when you click.
              </dd>
            </div>
            <div>
              <dt>Backups that are checked</dt>
              <dd>Total backs up as you work and regularly opens a backup to check it would restore. You can also lock a business with a passphrase.</dd>
            </div>
          </dl>
        </section>

        <section className={s.section} aria-labelledby="gst-title">
          <h2 id="gst-title" className={s.h2}>
            GST returns from the bills you already make.
          </h2>
          <p className={s.sub}>Total prepares the figures and the files. You file on the GST portal, as you do today.</p>
          <div className={s.gstGrid}>
            <figure className={s.gstShot}>
              <Image
                src={taxesLight}
                alt="The Taxes screen: GST you collected, GST on purchases, cash to pay by the 20th, the filing dates and the steps to file"
                sizes="(max-width: 900px) 100vw, 600px"
                className={s.shotImg}
              />
              <figcaption className={s.caption}>Taxes: what you owe, by when, and the steps to file.</figcaption>
            </figure>
            <figure className={s.gstShot}>
              <Image
                src={gstr1Light}
                alt="GSTR-1 for October 2026 in the accountant view: B2B invoices, HSN summary and documents issued, with an Export portal JSON button"
                sizes="(max-width: 900px) 100vw, 600px"
                className={s.shotImg}
              />
              <figcaption className={s.caption}>GSTR-1 in the accountant view, ready to export.</figcaption>
            </figure>
          </div>
          <ul className={s.gstList}>
            <li>
              <b>GSTR-1 and GSTR-3B</b> worked out from your bills and exported in the GST portal’s JSON format.
            </li>
            <li>
              <b>GSTR-2B check:</b> import the portal’s file and see which supplier bills are missing or differ.
            </li>
            <li>
              <b>e-Invoice and e-way bill</b> files for the government tools. Live filing with your own NIC login is
              built in but still being tested.
            </li>
            <li>
              <b>Monthly or quarterly filers</b>, composition and unregistered businesses: the bills print the way your
              registration requires.
            </li>
          </ul>
        </section>

        <section className={`${s.section} ${s.language}`} aria-labelledby="lang-title">
          <div className={s.langText}>
            <h2 id="lang-title" className={s.h2}>
              In English, Hindi or Hinglish.
            </h2>
            <p className={s.sub}>
              Screens, help, reminders and printed bills, including the amount in words. Ask a question the way you would
              say it, like “kitna udhaar hai?”, and Total answers from your books.
            </p>
            <p className={s.small}>The Hindi and Hinglish words are new. If something reads wrong, tell us.</p>
          </div>
          <figure className={s.langShot}>
            <Image
              src={homeHindi}
              alt="The same Home screen in Hindi"
              sizes="(max-width: 900px) 100vw, 640px"
              className={s.shotImg}
            />
          </figure>
        </section>

        <section className={`${s.section} ${s.more}`} aria-label="More about Total">
          <div>
            <h3 className={s.h3}>Coming from Tally?</h3>
            <p>
              Export your masters and day book from Tally as XML and bring them across in one step: ledgers, opening
              balances, GSTINs and entries. <Link href="/docs/coming-from-tally">How to move from Tally</Link>
            </p>
          </div>
          <div>
            <h3 className={s.h3}>Free for now</h3>
            <p>
              No subscription and no per-user fee while Total is in beta. The code is public on{' '}
              <a href={GITHUB}>GitHub</a>.
            </p>
          </div>
          <div>
            <h3 className={s.h3}>Mac, and Windows as a preview</h3>
            <p>
              macOS 13 or later on Apple Silicon. Windows is a preview: tested automatically on every change, but tried on few real PCs so far. Your books are a folder you can copy to another computer.
            </p>
          </div>
        </section>

        <section className={s.closing} aria-labelledby="closing-title">
          <h2 id="closing-title" className={s.closingTitle}>
            Be the first to hear about 1.0.
          </h2>
          <WaitlistForm id="closing" enabled={enabled} releasesUrl={releasesUrl} tone="inverse" />
        </section>
      </main>

      <footer className={s.footer}>
        <span>Total: offline accounting for Indian businesses.</span>
        <span className={s.footerLinks}>
          <Link href="/docs">Docs</Link>
          <Link href="/compare">Compare</Link>
          <Link href="/changelog">Changelog</Link>
          <a href={GITHUB}>GitHub</a>
          <Link href="/privacy">Privacy</Link>
          <a href="mailto:total@irminflow.com">total@irminflow.com</a>
        </span>
      </footer>
    </div>
  )
}
