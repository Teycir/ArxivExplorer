-- migrations/0017_topic_paper_counts.sql
--
-- Fixes the September 2026 D1 row-read exhaustion (see CHANGELOG post-mortem).
--
-- BEFORE: GET /api/topics, GET /api/stats and /sitemap.xml each ran 25 separate
--   COUNT(DISTINCT p.id) queries over papers_fts ⨝ papers ⨝ summaries.
--   Measured with `wrangler d1 insights`: that single query shape cost
--   42,226,877 rows read in 7 days (88 % of the account total) against a free-tier
--   budget of 5,000,000 rows/day.
--
-- AFTER: topics.paper_count is materialized once per cron run by the ingest
--   worker (refreshTopicCounts) and the public endpoints read it with one
--   indexed SELECT — tens of rows read per request instead of hundreds of
--   thousands.
--
-- Also adds the `counters` table so cheap aggregate badges (e.g. "N papers" on
-- the landing page) no longer cost a COUNT(*) scan per request — that query ran
-- 761×/day and read 1,528 rows each.
--
-- Run once:
--   npx wrangler d1 execute arxiv-explorer --remote --file=migrations/0017_topic_paper_counts.sql
--
-- NOTE: SQLite has no `ADD COLUMN IF NOT EXISTS`, so re-running this file errors
-- on the ALTER statement. Everything after the ALTER is idempotent.

-- ── 1. Materialized per-topic paper counts ──────────────────────────────────
ALTER TABLE topics ADD COLUMN paper_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_topics_paper_count ON topics(paper_count DESC);

-- ── 2. Small aggregate counters (one row read instead of a table scan) ──────
CREATE TABLE IF NOT EXISTS counters (
  name       TEXT PRIMARY KEY,
  value      INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO counters (name, value, updated_at)
VALUES ('papers_ready', 0, datetime('now'));

INSERT OR IGNORE INTO counters (name, value, updated_at)
VALUES ('papers_total', 0, datetime('now'));
