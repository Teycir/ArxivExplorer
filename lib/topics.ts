/**
 * lib/topics.ts — DELETED
 *
 * The topics list was previously maintained here as a TypeScript array
 * (slug → label + primary arXiv category).  It was the source of truth
 * for the UI chip list, the sitemap, and the 404 guard on the topic page.
 *
 * It has been replaced by the database:
 *
 *   topics          — slug, label, description (one row per topic)
 *   topic_categories — topic_slug, category_code, display_order  (FK join table)
 *   arxiv_categories — code, label, domain  (the category dictionary)
 *
 * Seeded by: migrations/0014_topic_categories_normalized.sql
 *
 * To add a topic:  INSERT INTO topics + INSERT INTO topic_categories
 * To remove one:   DELETE FROM topics WHERE slug = '...'  (cascades)
 * To add a cat:    INSERT INTO topic_categories (topic_slug, category_code, display_order)
 *
 * This file is kept as a tombstone so git history explains the removal.
 * All exports have been removed — any import will now produce a TypeScript
 * error, making stale references easy to find.
 */
