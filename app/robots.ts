import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/search', '/diff/', '/claim', '/compare'],
      },
      // Aggressive AI training crawlers and SEO scrapers: completely disallow to protect
      // the Cloudflare Workers 100,000 req/day free-tier budget.
      // (ClaudeBot and GPTBot alone generated >29,600 requests in a single day).
      { userAgent: 'GPTBot',                    disallow: ['/', '/api/'] },
      { userAgent: 'ClaudeBot',                 disallow: ['/', '/api/'] },
      { userAgent: 'PerplexityBot',             disallow: ['/', '/api/'] },
      { userAgent: 'Applebot',                  disallow: ['/', '/api/'] },
      { userAgent: 'Applebot-Extended',         disallow: ['/', '/api/'] },
      { userAgent: 'cohere-ai',                 disallow: ['/', '/api/'] },
      { userAgent: 'Bytespider',                disallow: ['/', '/api/'] },
      { userAgent: 'CCBot',                     disallow: ['/', '/api/'] },
      { userAgent: 'Diffbot',                   disallow: ['/', '/api/'] },
      { userAgent: 'FacebookBot',               disallow: ['/', '/api/'] },
      { userAgent: 'Google-Extended',           disallow: ['/', '/api/'] },
      { userAgent: 'SemrushBot',                disallow: ['/', '/api/'] },
      { userAgent: 'AhrefsBot',                 disallow: ['/', '/api/'] },
      { userAgent: 'MJ12bot',                   disallow: ['/', '/api/'] },
      { userAgent: 'DotBot',                    disallow: ['/', '/api/'] },
      { userAgent: 'PetalBot',                  disallow: ['/', '/api/'] },
      { userAgent: 'SERankingBacklinksBot',     disallow: ['/', '/api/'] },
      { userAgent: 'Reflectionbot',             disallow: ['/', '/api/'] },
    ],
    sitemap: 'https://arxivexplorer.arxivexplorer.workers.dev/sitemap.xml',
    host: 'https://arxivexplorer.arxivexplorer.workers.dev',
  };
}
