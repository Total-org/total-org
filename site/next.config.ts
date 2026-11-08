import type { NextConfig } from 'next'
import { siteRedirects } from './lib/redirects.ts'
import { siteHeaders } from './lib/security.ts'

const nextConfig: NextConfig = {
  // Security headers on pages and static files, never on /api/* (lib/security.ts). The CSP itself,
  // with its per-request nonce, is set by proxy.ts.
  async headers() {
    return siteHeaders()
  },
  async redirects() {
    return siteRedirects()
  }
}

export default nextConfig
