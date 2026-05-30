-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS papers_fts;
DROP TRIGGER IF EXISTS papers_fts_insert;
DROP TRIGGER IF EXISTS papers_fts_update;
DROP TRIGGER IF EXISTS papers_fts_delete;
DROP TABLE IF EXISTS embeddings_meta;
DROP TABLE IF EXISTS related_papers;
DROP TABLE IF EXISTS summaries;
DROP TABLE IF EXISTS papers;
DROP TABLE IF EXISTS topics;
