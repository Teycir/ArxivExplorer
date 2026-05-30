import type { MetadataRoute } from 'next';

const BASE_URL = 'https://arxiv-explorer.pages.dev';

/**
 * app/sitemap.ts
 * Static routes only — dynamic paper/topic/author routes are served
 * by the api-worker /api/sitemap endpoint (fetched and cached there).
 *
 * For a full sitemap (papers + topics), wire up the api-worker sitemap
 * or fetch it here. For now we emit static routes only to keep
 * the build fast (paper sitemap = api-worker's responsibility).
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
    // Topic pages
    ...[
      'large-language-models',
      'diffusion-models',
      'rag-retrieval',
      'reinforcement-learning',
      'computer-vision',
      'multimodal',
      'efficient-ml',
      'agents-planning',
      'alignment-safety',
      'graph-neural-networks',
    ].map((slug) => ({
      url: `${BASE_URL}/topic/${slug}`,
      lastModified: new Date(),
      changeFrequency: 'daily' as const,
      priority: 0.7,
    })),
  ];
}
