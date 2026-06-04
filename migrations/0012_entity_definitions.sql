-- Entity definitions for terminology tooltips
-- Stores AI-generated definitions for entity names (models, datasets, benchmarks)

CREATE TABLE IF NOT EXISTS entity_definitions (
  entity_name TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_definitions_generated 
  ON entity_definitions(generated_at DESC);
