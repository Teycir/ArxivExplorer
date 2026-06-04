-- Citation velocity tracking
-- Stores historical citation counts to compute momentum

CREATE TABLE IF NOT EXISTS citation_snapshots (
  paper_id TEXT NOT NULL,
  citation_count INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (paper_id, recorded_at)
);

-- Index for velocity queries (papers with recent growth)
CREATE INDEX IF NOT EXISTS idx_citation_snapshots_recorded 
  ON citation_snapshots(recorded_at DESC);

-- Index for per-paper historical lookup
CREATE INDEX IF NOT EXISTS idx_citation_snapshots_paper 
  ON citation_snapshots(paper_id, recorded_at DESC);
