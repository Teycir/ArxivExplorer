import type { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/'],
      },
      // Explicitly welcome AI crawlers
      { userAgent: 'GPTBot', allow: '/' },
      { userAgent: 'ClaudeBot', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Applebot', allow: '/' },
      { userAgent: 'cohere-ai', allow: '/' },
    ],
    sitemap: 'https://arxivexplorer.arxivexplorer.workers.dev/sitemap.xml',
    host: 'https://arxivexplorer.arxivexplorer.workers.dev',
  };
}
