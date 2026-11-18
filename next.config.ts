import type { NextConfig } from 'next'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}

// Single source of truth for the release number: package.json. It is inlined at
// build time so the footer shows exactly which release is deployed (read only
// the version — importing the whole package.json would bundle it into the app).
const APP_VERSION: string = JSON.parse(
  readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
).version

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: APP_VERSION,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: ['framer-motion', 'motion-dom', 'motion-utils'],
  images: {
    unoptimized: true, // no <Image> in app/; disable the /_next/image optimizer surface
  },

  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "worker-src 'self' blob:",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https://arxiv.org",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' https://arxiv-api.arxivexplorer.workers.dev",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=()' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'X-Frame-Options',           value: 'DENY' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control',    value: 'on' },
        ],
      },
    ]
  },
}

export default nextConfig
