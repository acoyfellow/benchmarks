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
  benchmark_id TEXT NOT NULL REFERENCES benchmark_definitions(id),
  model_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

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
  latency_ms INTEGER,
  error TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
