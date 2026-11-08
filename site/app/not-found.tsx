import type { Metadata } from 'next'
import Link from 'next/link'
import SiteNav from '@/components/SiteNav'

export const metadata: Metadata = {
  title: 'Page not found — Total'
}

/**
 * The site's own 404 (Next's built-in one writes an inline <style> without the CSP nonce, which the
 * policy in lib/security.ts blocks).
 */
export default function NotFound(): React.JSX.Element {
  return (
    <>
      <SiteNav />
      <div className="wrap">
        <section className="docs-content">
          <h1 className="serif">Page not found</h1>
          <p className="sub">
            There is no page at this address. <Link href="/">Go to the home page</Link> or{' '}
            <Link href="/docs">read the docs</Link>.
          </p>
        </section>
      </div>
    </>
  )
}
