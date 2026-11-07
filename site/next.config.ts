import type { NextConfig } from 'next'
import { siteRedirects } from './lib/redirects'

const nextConfig: NextConfig = {
  async redirects() {
    return siteRedirects()
  }
}

export default nextConfig
