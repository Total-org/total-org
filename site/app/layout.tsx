import type { Metadata } from 'next'
import { connection } from 'next/server'
import { IBM_Plex_Sans, IBM_Plex_Serif, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const sans = IBM_Plex_Sans({ subsets: ['latin'], weight: ['400', '500', '600'], variable: '--font-sans' })
// Serif and mono are used by the docs / changelog / compare pages only: loaded there, never preloaded,
// so the landing page's first paint waits on the sans alone.
const serif = IBM_Plex_Serif({ subsets: ['latin'], weight: ['600', '700'], variable: '--font-serif', preload: false })
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'], variable: '--font-mono', preload: false })

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://irminflow.com'),
  title: 'Total — offline accounting for Indian businesses',
  description:
    'Accounting for Indian shops and their CAs: bills, GST returns (GSTR-1, GSTR-3B, e-invoice), stock and bank, in plain words or the full accountant view. Works offline; your books stay on your computer. In English, Hindi and Hinglish.',
  openGraph: {
    title: 'Total — your accounts, on your own computer',
    description: 'Bills, GST returns, stock and bank for Indian shops and their CAs. Works offline; free while in beta. Join the 1.0 waitlist.',
    type: 'website',
    siteName: 'Total'
  },
  twitter: { card: 'summary_large_image' }
}

export default async function RootLayout({ children }: { children: React.ReactNode }): Promise<React.JSX.Element> {
  // Every page renders per request so Next.js can put the request's CSP nonce (proxy.ts) on its
  // scripts — a page built ahead of time would carry no nonce and its scripts would be blocked.
  // The GitHub lookups stay cached for 5 minutes (fetch revalidate), so this costs a render, not a call.
  await connection()
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  )
}
