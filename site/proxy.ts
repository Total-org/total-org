import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy, newNonce } from './lib/security.ts'

/**
 * A fresh CSP nonce for every page (lib/security.ts). Next.js reads the nonce from the request's
 * Content-Security-Policy header and puts it on its own scripts; the same policy goes on the response.
 * Runs AFTER next.config's redirects (devjindal.tech → irminflow.com are untouched) and never on
 * /api/* — /api/latest and /api/download answer installed apps exactly as before.
 */
export function proxy(request: NextRequest): NextResponse {
  const csp = contentSecurityPolicy(newNonce(), process.env.NODE_ENV === 'development')
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: [
    {
      // Pages only: not /api (or /api/…), Next's static files and images, or the public files.
      source: '/((?!api(?:/|$)|_next/static/|_next/image|favicon\\.ico$|icon\\.png$|icon-64\\.png$|shots/|opengraph-image).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' }
      ]
    }
  ]
}
