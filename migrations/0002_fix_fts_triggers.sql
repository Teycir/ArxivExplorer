-- Fix FTS triggers to use rowid instead of paper_id column
-- FTS5 UNINDEXED columns cannot be used in WHERE clauses

DROP TRIGGER IF EXISTS papers_fts_update;
DROP TRIGGER IF EXISTS papers_fts_delete;

CREATE TRIGGER papers_fts_update AFTER UPDATE ON papers BEGIN
  UPDATE papers_fts
  SET title=new.title, abstract=new.abstract, authors=new.authors, paper_id=new.id
  WHERE rowid=new.rowid;
END;

CREATE TRIGGER papers_fts_delete AFTER DELETE ON papers BEGIN
  DELETE FROM papers_fts WHERE rowid=old.rowid;
END;
