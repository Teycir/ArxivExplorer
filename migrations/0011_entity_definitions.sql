-- Entity definitions for terminology tooltips
CREATE TABLE IF NOT EXISTS entity_definitions (
  entity_name TEXT PRIMARY KEY,
  definition TEXT NOT NULL,
  generated_at TEXT NOT NULL DEFAULT (datetime('now')),
  model_version TEXT
);

CREATE INDEX IF NOT EXISTS idx_entity_definitions_name 
  ON entity_definitions(entity_name);
