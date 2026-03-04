-- Semantic Analyzer schema
-- Apply with: wrangler d1 execute semantic-db --file=d1/semantic-schema.sql

CREATE TABLE IF NOT EXISTS semantic_events (
  event_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  type TEXT NOT NULL,
  complexity_score REAL,
  narrative TEXT,
  graph_hash TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS semantic_units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL,
  dimension TEXT NOT NULL,
  value TEXT NOT NULL,
  confidence REAL DEFAULT 1.0,
  FOREIGN KEY (event_id) REFERENCES semantic_events(event_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_su_event ON semantic_units(event_id);
CREATE INDEX IF NOT EXISTS idx_su_dimension ON semantic_units(dimension, value);
CREATE INDEX IF NOT EXISTS idx_se_source ON semantic_events(source, type);
