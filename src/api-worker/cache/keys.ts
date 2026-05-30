/**
 * src/api-worker/cache/keys.ts
 * All KV cache key constants — single source of truth.
 * Never build keys inline; always use these functions.
 */

/** Full paper + joined summary (permanent, no TTL). */
export const kvPaperFull = (arxivId: string) => `kv:paper:${arxivId}:full`;

/** Pre-computed related papers (permanent, no TTL). */
export const kvPaperRelated = (arxivId: string) => `kv:paper:${arxivId}:related`;

/** Search results cache (TTL 2h). */
export const kvSearch = (queryHash: string) => `kv:search:${queryHash}`;

/** Query embedding cache (TTL 24h). */
export const kvEmbed = (queryHash: string) => `kv:embed:${queryHash}`;

/** Topic page results (TTL 12h). */
export const kvTopic = (slug: string) => `kv:topic:${slug}`;

/** Trending papers list (TTL 60min). */
export const KV_TRENDING = 'kv:trending';

/** Author page results (TTL 6h). */
export const kvAuthor = (name: string) => `kv:author:${encodeURIComponent(name)}`;

/** Sitemap XML (TTL 24h). */
export const KV_SITEMAP = 'kv:sitemap';

// ─── TTL constants (in seconds) ────────────────────────────────────────────
export const TTL_SEARCH = 7_200;          // 2h
export const TTL_TRENDING = 3_600;        // 60min
export const TTL_EMBED = 86_400;          // 24h
export const TTL_TOPIC = 43_200;          // 12h
export const TTL_AUTHOR = 21_600;         // 6h
export const TTL_SITEMAP = 86_400;        // 24h
// Paper + related: permanent (no TTL — papers are immutable)
