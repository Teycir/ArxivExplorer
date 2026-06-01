import type { MetadataRoute } from 'next';
import { TOPICS } from '@/lib/topics';

// Canonical production URL — Workers frontend.
const BASE_URL = 'https://arxivexplorer.arxivexplorer.workers.dev';

/**
 * app/sitemap.ts
 * Static routes only — dynamic paper/topic/author routes are served
 * by the api-worker /api/sitemap endpoint (fetched and cached there).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'hourly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/faq`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/how-to-use`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    // Topic pages — derived from lib/topics.ts (single source of truth)
    ...TOPICS.map((t) => ({
      url: `${BASE_URL}/topic/${t.slug}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
