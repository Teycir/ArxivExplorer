-- Add metadata fields to papers table
ALTER TABLE papers ADD COLUMN comment TEXT;
ALTER TABLE papers ADD COLUMN journal_ref TEXT;
ALTER TABLE papers ADD COLUMN doi TEXT;
ALTER TABLE papers ADD COLUMN primary_category TEXT;
ALTER TABLE papers ADD COLUMN citation_count INTEGER DEFAULT 0;
ALTER TABLE papers ADD COLUMN citations_updated_at TEXT;
