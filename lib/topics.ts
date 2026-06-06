/**
 * lib/topics.ts — DELETED
 *
 * The topics list was previously maintained here as a TypeScript array
 * (slug → label + primary arXiv category).  It was the source of truth
 * for the UI chip list, the sitemap, and the 404 guard on the topic page.
 *
 * It has been replaced by the database:
 *
 *   topics — slug, label, description, keywords (one row per topic)
 *
 * Keywords are a space-separated list of terms used by the FTS routing
 * layer (getPapersByTopic in src/shared/db.ts) to match papers to topics.
 *
 * Seeded by: migrations/0015_drop_category_joins.sql
 *
 * To add a topic:   INSERT INTO topics (slug, label, description, keywords, updated_at)
 * To remove one:    DELETE FROM topics WHERE slug = '...'
 * To update keywords: UPDATE topics SET keywords = '...' WHERE slug = '...'
 *
 * NOTE: topic_categories, arxiv_categories, and paper_categories were all
 * dropped in migration 0015. Routing is now purely FTS-based via topics.keywords.
 *
 * This file is kept as a tombstone so git history explains the removal.
 * All exports have been removed — any import will now produce a TypeScript
 * error, making stale references easy to find.
 */
