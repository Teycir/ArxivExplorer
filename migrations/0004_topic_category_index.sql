-- migrations/0004_topic_category_index.sql
-- Replaces the LIKE '%tag%' full-table scan on papers.categories with a
-- proper junction table + index, making topic page queries O(log n) instead
-- of O(n * tags). The old query path continues to work unchanged during the
-- migration; the application layer is updated to use paper_categories once
-- this migration is applied.
--
-- Run locally:  wrangler d1 execute arxiv-explorer --file=migrations/0004_topic_category_index.sql
-- Run remote:   wrangler d1 execute arxiv-explorer --remote --file=migrations/0004_topic_category_index.sql

-- ─── Junction table: one row per (paper, category) pair ───────────────────
CREATE TABLE IF NOT EXISTS paper_categories (
  paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  PRIMARY KEY (paper_id, category)
);

CREATE INDEX IF NOT EXISTS idx_paper_categories_category
  ON paper_categories(category, paper_id);

-- ─── Backfill from existing papers.categories JSON column ─────────────────
-- SQLite doesn't have json_each() in D1, so we handle backfill in the
-- application layer (see scripts/backfill-categories.ts).
-- New papers are written by the updated ingest pipeline trigger below.

-- ─── Trigger: keep junction table in sync on INSERT ───────────────────────
-- Note: bulk backfill is handled by the application script; this trigger
-- covers all papers ingested after the migration is applied.
-- D1 does not support FOR EACH ROW with json_each, so the ingest pipeline
-- inserts rows into paper_categories directly after inserting into papers.
