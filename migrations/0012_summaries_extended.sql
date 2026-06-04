-- Extended summary fields and entity definitions
-- Combines problem_statement field + entity_definitions table

-- Add problem_statement field to summaries table
ALTER TABLE summaries ADD COLUMN problem_statement TEXT;

-- Create FTS index for problem search
CREATE VIRTUAL TABLE IF NOT EXISTS problems_fts USING fts5(
  paper_id UNINDEXED,
  problem_statement,
  content=summaries,
  content_rowid=rowid
);

-- Populate FTS from existing summaries
INSERT INTO problems_fts(paper_id, problem_statement)
SELECT paper_id, problem_statement FROM summaries WHERE problem_statement IS NOT NULL;

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS problems_fts_insert AFTER INSERT ON summaries BEGIN
  INSERT INTO problems_fts(rowid, paper_id, problem_statement)
  VALUES (new.rowid, new.paper_id, new.problem_statement);
END;

CREATE TRIGGER IF NOT EXISTS problems_fts_update AFTER UPDATE ON summaries BEGIN
  UPDATE problems_fts SET problem_statement = new.problem_statement WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS problems_fts_delete AFTER DELETE ON summaries BEGIN
  DELETE FROM problems_fts WHERE rowid = old.rowid;
END;

-- Entity definitions table for terminology tooltips
CREATE TABLE IF NOT EXISTS entity_definitions (
  entity_name TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_entity_definitions_name 
  ON entity_definitions(entity_name);
