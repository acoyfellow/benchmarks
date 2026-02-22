DROP TABLE IF EXISTS results;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS benchmark_definitions;

CREATE TABLE IF NOT EXISTS benchmark_definitions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL,
  config TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL,
  benchmark_id TEXT NOT NULL REFERENCES benchmark_definitions(id),
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_runs_batch ON runs(batch_id);
CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model_id);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  prompt_index INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  expected_tool TEXT NOT NULL,
  expected_args TEXT,
  actual_response TEXT,
  tool_called TEXT,
  tool_correct INTEGER NOT NULL DEFAULT 0,
  args_correct INTEGER NOT NULL DEFAULT 0,
  args_score REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_results_run ON results(run_id);
