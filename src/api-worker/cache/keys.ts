/**
 * src/api-worker/cache/keys.ts
 * All KV cache key constants — single source of truth.
 * Never build keys inline; always use these functions.
 */

/** Full paper + joined summary (permanent, no TTL).
 * v2: bumped after citationCount was added to PAPER_SELECT (2026-06-06).
 * Old v1 keys (kv:paper:<id>:full) are now orphaned and will expire in 7d. */
export const kvPaperFull = (arxivId: string) => `kv:paper:${arxivId}:full:v2`;

/** Pre-computed related papers (permanent, no TTL). */
export const kvPaperRelated = (arxivId: string) => `kv:paper:${arxivId}:related`;

/** Search results cache (TTL 2h). */
export const kvSearch = (queryHash: string) => `kv:search:${queryHash}`;

/** Query embedding cache (TTL 24h). */
export const kvEmbed = (queryHash: string) => `kv:embed:${queryHash}`;

/** Topic page results (TTL 12h). */
export const kvTopic = (slug: string) => `kv:topic:${slug}`;

/** Trending papers — one key per window. */
export const KV_TRENDING = 'kv:trending:week';  // kept for back-compat
export const kvTrending = (window: 'day' | 'week' | 'month') => `kv:trending:${window}`;

/** Author page results (TTL 6h). */
export const kvAuthor = (name: string) => `kv:author:${encodeURIComponent(name)}`;

/** Sitemap XML (TTL 24h). */
export const KV_SITEMAP = 'kv:sitemap';

/** Topics list with paper counts (TTL 1h). */
export const KV_TOPICS = 'kv:topics:with-papers';

/** Landing/explore aggregate stats (TTL 1h).
 * v5: payload now comes from the materialized `counters` + `topics.paper_count`
 * columns (migration 0017) instead of 25 live FTS count joins. */
export const KV_STATS = 'kv:stats:v5';

/**
 * Every key that must be dropped when the materialized counts change.
 * Single source of truth — the ingest worker used to invalidate the stale
 * `kv:stats:v2` key while stats.ts read `kv:stats:v4`, so the stats cache was
 * never actually invalidated.
 */
export const DERIVED_COUNT_KEYS = [KV_TOPICS, KV_STATS, KV_SITEMAP] as const;

// ─── TTL constants (in seconds) ────────────────────────────────────────────
export const TTL_TOPICS = 3_600;          // 1h
export const TTL_SEARCH = 7_200;          // 2h
export const TTL_TRENDING_DAY   = 600;    // 10min  (day window — changes fast)
export const TTL_TRENDING       = 3_600;  // 60min  (week window — default)
export const TTL_TRENDING_MONTH = 10_800; // 3h     (month window — stable)
export const TTL_EMBED = 86_400;          // 24h
export const TTL_TOPIC = 43_200;          // 12h
export const TTL_AUTHOR = 21_600;         // 6h
export const TTL_SITEMAP = 86_400;        // 24h
// Paper + related: permanent (no TTL — papers are immutable)
