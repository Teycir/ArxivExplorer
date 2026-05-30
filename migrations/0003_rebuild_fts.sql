-- Rebuild FTS table without external content to avoid trigger issues
-- This makes FTS self-contained and avoids the T.paper_id error

DROP TRIGGER IF EXISTS papers_fts_insert;
DROP TRIGGER IF EXISTS papers_fts_update;
DROP TRIGGER IF EXISTS papers_fts_delete;
DROP TABLE IF EXISTS papers_fts;

-- Create self-contained FTS table (no content= option)
CREATE VIRTUAL TABLE papers_fts USING fts5(
  paper_id UNINDEXED,
  title,
  abstract,
  authors
);

-- Populate from existing papers
INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
SELECT rowid, id, title, abstract, authors FROM papers;

-- Recreate triggers for self-contained FTS
CREATE TRIGGER papers_fts_insert AFTER INSERT ON papers BEGIN
  INSERT INTO papers_fts(rowid, paper_id, title, abstract, authors)
  VALUES (new.rowid, new.id, new.title, new.abstract, new.authors);
END;

CREATE TRIGGER papers_fts_update AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts
  SET title=new.title, abstract=new.abstract, authors=new.authors, paper_id=new.id
  WHERE rowid=new.rowid;
END;

CREATE TRIGGER papers_fts_delete AFTER DELETE ON papers BEGIN
  DELETE FROM papers_fts WHERE rowid=old.rowid;
END;
