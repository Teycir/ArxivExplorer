import type { MetadataRoute } from 'next';
import { getTopics } from '@/helper/api';

// Canonical production URL — Workers frontend.
const BASE_URL = 'https://arxivexplorer.arxivexplorer.workers.dev';

// /sitemap.xml is the most re-fetched URL on any site. Rebuilding it on every
// request would run two D1 queries per crawler hit for no reason.
export const revalidate = 86400;

/**
 * app/sitemap.ts
 * Static routes only — dynamic paper/topic/author routes are served
 * by the api-worker /api/sitemap endpoint (fetched and cached there).
 * Topics are sourced from the DB (via /api/topics) so this stays in sync
 * automatically as topics are added or removed.
 *
 * This call is cheap: since migration 0017 /api/topics reads the materialized
 * `topics.paper_count` column (one indexed SELECT over ~25 rows) instead of 25
 * live FTS count joins — the version of this file that ran before that fix was
 * one of the heaviest contributors to the Sept 2026 D1 quota outage.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let topicSlugs: string[] = [];
  try {
    const { topics } = await getTopics();
    topicSlugs = topics.map(t => t.slug);
  } catch {
    // Non-fatal — sitemap works without topic URLs
  }

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
    // Topic pages — sourced from DB, auto-updates as topics are added/removed
    ...topicSlugs.map((slug) => ({
      url: `${BASE_URL}/topic/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
