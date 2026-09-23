import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
      // Explicitly welcome AI crawlers — for the SITE only.
      //
      // A specific user-agent group REPLACES the `*` group for that crawler, so
      // each rule below has to repeat the /api/ disallow. Before it did, bots
      // were told they could fetch the raw JSON API directly, which is what let
      // them saturate the D1 read budget (see the CHANGELOG post-mortem).
      { userAgent: 'GPTBot',        allow: '/', disallow: ['/api/'] },
      { userAgent: 'ClaudeBot',     allow: '/', disallow: ['/api/'] },
      { userAgent: 'PerplexityBot', allow: '/', disallow: ['/api/'] },
      { userAgent: 'Applebot',      allow: '/', disallow: ['/api/'] },
      { userAgent: 'cohere-ai',     allow: '/', disallow: ['/api/'] },
      { userAgent: 'Bytespider',    allow: '/', disallow: ['/api/'] },
      { userAgent: 'CCBot',         disallow: ['/api/'] },
    ],
    sitemap: 'https://arxivexplorer.arxivexplorer.workers.dev/sitemap.xml',
    host: 'https://arxivexplorer.arxivexplorer.workers.dev',
  };
}
