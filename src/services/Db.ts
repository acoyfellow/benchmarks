/// <reference types="@cloudflare/workers-types" />
import { Effect, Layer } from "effect"
import { DbError } from "../errors/index.js"

export interface BenchmarkDefinition {
  id: string
  name: string
  description: string | null
  type: string
  config: string
  created_at: number
}

export interface Run {
  id: string
  batch_id: string
  benchmark_id: string
  model_id: string
  status: string
  started_at: number | null
  completed_at: number | null
  created_at: number
}

export interface Result {
  id: string
  run_id: string
  prompt_index: number
  prompt: string
  expected_tool: string
  expected_args: string | null
  actual_response: string | null
  tool_called: string | null
  tool_correct: number
  args_correct: number
  args_score: number
  latency_ms: number | null
  error: string | null
  created_at: number
}

export interface LeaderboardEntry {
  model_id: string
  total_runs: number
  total_prompts: number
  avg_tool_pct: number
  avg_args_score: number
  consistency: number
  consistent_runs: number
  p50_latency_ms: number
  p95_latency_ms: number
  min_latency_ms: number
  max_latency_ms: number
}

export interface BatchStatus {
  batch_id: string
  model_id: string
  benchmark_id: string
  total: number
  complete: number
  failed: number
  running: number
  pending: number
}

interface DbMethods {
  getBenchmarks: () => Effect.Effect<BenchmarkDefinition[], DbError>
  getBenchmark: (id: string) => Effect.Effect<BenchmarkDefinition | null, DbError>
  createRun: (run: {
    id: string
    batch_id: string
    benchmark_id: string
    model_id: string
  }) => Effect.Effect<{ id: string; batch_id: string; benchmark_id: string; model_id: string }, DbError>
  getRun: (id: string) => Effect.Effect<Run | null, DbError>
  updateRunStatus: (
    id: string,
    status: string,
    timestamps?: { started_at?: number; completed_at?: number }
  ) => Effect.Effect<void, DbError>
  listRuns: (limit?: number) => Effect.Effect<Run[], DbError>
  getBatchStatus: (batchId: string) => Effect.Effect<BatchStatus | null, DbError>
  listBatches: (limit?: number) => Effect.Effect<BatchStatus[], DbError>
  getLeaderboard: () => Effect.Effect<LeaderboardEntry[], DbError>
  getModelLatencies: (modelId: string) => Effect.Effect<number[], DbError>
  getModelRunScores: (modelId: string) => Effect.Effect<Array<{ run_id: string; tool_pct: number; args_score: number; avg_latency: number; created_at: number }>, DbError>
  getResults: (runId: string) => Effect.Effect<Result[], DbError>
  insertResult: (result: Result) => Effect.Effect<void, DbError>
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

const notInitialized = (): DbError =>
  new DbError({
    message:
      "Db service not initialized. Provide Db.layer when building the Effect environment.",
  })

export class Db extends Effect.Service<Db>()("Db", {
  effect: Effect.succeed<DbMethods>({
    getBenchmarks: () => Effect.fail(notInitialized()),
    getBenchmark: () => Effect.fail(notInitialized()),
    createRun: () => Effect.fail(notInitialized()),
    getRun: () => Effect.fail(notInitialized()),
    updateRunStatus: () => Effect.fail(notInitialized()),
    listRuns: () => Effect.fail(notInitialized()),
    getBatchStatus: () => Effect.fail(notInitialized()),
    listBatches: () => Effect.fail(notInitialized()),
    getLeaderboard: () => Effect.fail(notInitialized()),
    getModelLatencies: () => Effect.fail(notInitialized()),
    getModelRunScores: () => Effect.fail(notInitialized()),
    getResults: () => Effect.fail(notInitialized()),
    insertResult: () => Effect.fail(notInitialized()),
  }),
}) {
  static layer = (db: D1Database) =>
    Layer.succeed(
      Db,
      {
        getBenchmarks: () =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare("SELECT * FROM benchmark_definitions")
                .all<BenchmarkDefinition>()
                .then((r) => r.results),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        getBenchmark: (id: string) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare("SELECT * FROM benchmark_definitions WHERE id = ?")
                .bind(id)
                .first<BenchmarkDefinition>(),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        createRun: (run: {
          id: string
          batch_id: string
          benchmark_id: string
          model_id: string
        }) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  "INSERT INTO runs (id, batch_id, benchmark_id, model_id, status) VALUES (?, ?, ?, ?, 'pending')"
                )
                .bind(run.id, run.batch_id, run.benchmark_id, run.model_id)
                .run(),
            catch: (e) => new DbError({ message: String(e) }),
          }).pipe(Effect.map(() => run)),

        getRun: (id: string) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare("SELECT * FROM runs WHERE id = ?")
                .bind(id)
                .first<Run>(),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        updateRunStatus: (
          id: string,
          status: string,
          timestamps?: { started_at?: number; completed_at?: number }
        ) => {
          const setClauses: string[] = ["status = ?"]
          const params: unknown[] = [status]

          if (timestamps?.started_at !== undefined) {
            setClauses.push("started_at = ?")
            params.push(timestamps.started_at)
          }

          if (timestamps?.completed_at !== undefined) {
            setClauses.push("completed_at = ?")
            params.push(timestamps.completed_at)
          }

          const query = `UPDATE runs SET ${setClauses.join(", ")} WHERE id = ?`
          params.push(id)

          return Effect.tryPromise({
            try: () =>
              db
                .prepare(query)
                .bind(...params)
                .run(),
            catch: (e) => new DbError({ message: String(e) }),
          }).pipe(Effect.asVoid)
        },

        listRuns: (limit = 50) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  "SELECT * FROM runs ORDER BY created_at DESC LIMIT ?"
                )
                .bind(limit)
                .all<Run>()
                .then((r) => r.results),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        getBatchStatus: (batchId: string) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  `SELECT
                    batch_id,
                    model_id,
                    benchmark_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
                  FROM runs
                  WHERE batch_id = ?
                  GROUP BY batch_id`
                )
                .bind(batchId)
                .first<BatchStatus>(),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        listBatches: (limit = 20) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  `SELECT
                    batch_id,
                    model_id,
                    benchmark_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'complete' THEN 1 ELSE 0 END) as complete,
                    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
                    SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                    SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending
                  FROM runs
                  GROUP BY batch_id
                  ORDER BY MAX(created_at) DESC
                  LIMIT ?`
                )
                .bind(limit)
                .all<BatchStatus>()
                .then((r) => r.results),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        getLeaderboard: () =>
          Effect.tryPromise({
            try: async () => {
              // Step 1: Get per-run scores for each model
              const runScores = await db
                .prepare(
                  `SELECT
                    r.model_id,
                    r.id as run_id,
                    ROUND(100.0 * SUM(res.tool_correct) / COUNT(*)) as tool_pct,
                    ROUND(AVG(res.args_score) * 100) as args_score_pct,
                    CASE WHEN SUM(res.tool_correct) = COUNT(*) THEN 1 ELSE 0 END as perfect_tools
                  FROM runs r
                  JOIN results res ON r.id = res.run_id
                  WHERE r.status = 'complete' AND res.error IS NULL
                  GROUP BY r.id`
                )
                .all<{ model_id: string; run_id: string; tool_pct: number; args_score_pct: number; perfect_tools: number }>()
                .then((r) => r.results)

              // Step 2: Get all latencies per model
              const latencies = await db
                .prepare(
                  `SELECT r.model_id, res.latency_ms
                  FROM runs r
                  JOIN results res ON r.id = res.run_id
                  WHERE r.status = 'complete' AND res.error IS NULL AND res.latency_ms IS NOT NULL
                  ORDER BY r.model_id, res.latency_ms`
                )
                .all<{ model_id: string; latency_ms: number }>()
                .then((r) => r.results)

              // Group by model
              const modelMap = new Map<string, {
                runScores: Array<{ tool_pct: number; args_score_pct: number; perfect_tools: number }>
                latencies: number[]
              }>()

              for (const rs of runScores) {
                if (!modelMap.has(rs.model_id)) {
                  modelMap.set(rs.model_id, { runScores: [], latencies: [] })
                }
                modelMap.get(rs.model_id)!.runScores.push(rs)
              }

              for (const lat of latencies) {
                if (!modelMap.has(lat.model_id)) continue
                modelMap.get(lat.model_id)!.latencies.push(lat.latency_ms)
              }

              // Compute stats
              const entries: LeaderboardEntry[] = []
              for (const [modelId, data] of modelMap) {
                const runs = data.runScores
                const lats = data.latencies.sort((a, b) => a - b)
                const totalRuns = runs.length
                const totalPrompts = lats.length
                const avgToolPct = Math.round(runs.reduce((s, r) => s + r.tool_pct, 0) / totalRuns)
                const avgArgsScore = Math.round(runs.reduce((s, r) => s + r.args_score_pct, 0) / totalRuns)
                const consistentRuns = runs.filter((r) => r.perfect_tools === 1).length
                const consistency = Math.round((consistentRuns / totalRuns) * 100)

                entries.push({
                  model_id: modelId,
                  total_runs: totalRuns,
                  total_prompts: totalPrompts,
                  avg_tool_pct: avgToolPct,
                  avg_args_score: avgArgsScore,
                  consistency,
                  consistent_runs: consistentRuns,
                  p50_latency_ms: percentile(lats, 50),
                  p95_latency_ms: percentile(lats, 95),
                  min_latency_ms: lats[0] ?? 0,
                  max_latency_ms: lats[lats.length - 1] ?? 0,
                })
              }

              // Sort: consistency first, then tool accuracy, then args, then latency
              entries.sort((a, b) => {
                if (b.consistency !== a.consistency) return b.consistency - a.consistency
                if (b.avg_tool_pct !== a.avg_tool_pct) return b.avg_tool_pct - a.avg_tool_pct
                if (b.avg_args_score !== a.avg_args_score) return b.avg_args_score - a.avg_args_score
                return a.p50_latency_ms - b.p50_latency_ms
              })

              return entries
            },
            catch: (e) => new DbError({ message: String(e) }),
          }),

        getModelLatencies: (modelId: string) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  `SELECT res.latency_ms
                  FROM runs r
                  JOIN results res ON r.id = res.run_id
                  WHERE r.model_id = ? AND r.status = 'complete' AND res.error IS NULL AND res.latency_ms IS NOT NULL
                  ORDER BY res.latency_ms`
                )
                .bind(modelId)
                .all<{ latency_ms: number }>()
                .then((r) => r.results.map((row) => row.latency_ms)),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        getModelRunScores: (modelId: string) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  `SELECT
                    r.id as run_id,
                    ROUND(100.0 * SUM(res.tool_correct) / COUNT(*)) as tool_pct,
                    ROUND(AVG(res.args_score) * 100) as args_score,
                    ROUND(AVG(res.latency_ms)) as avg_latency,
                    r.created_at
                  FROM runs r
                  JOIN results res ON r.id = res.run_id
                  WHERE r.model_id = ? AND r.status = 'complete' AND res.error IS NULL
                  GROUP BY r.id
                  ORDER BY r.created_at DESC`
                )
                .bind(modelId)
                .all<{ run_id: string; tool_pct: number; args_score: number; avg_latency: number; created_at: number }>()
                .then((r) => r.results),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        getResults: (runId: string) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  "SELECT * FROM results WHERE run_id = ? ORDER BY prompt_index"
                )
                .bind(runId)
                .all<Result>()
                .then((r) => r.results),
            catch: (e) => new DbError({ message: String(e) }),
          }),

        insertResult: (result: Result) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  `INSERT INTO results (id, run_id, prompt_index, prompt, expected_tool, expected_args, actual_response, tool_called, tool_correct, args_correct, args_score, latency_ms, error)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .bind(
                  result.id,
                  result.run_id,
                  result.prompt_index,
                  result.prompt,
                  result.expected_tool,
                  result.expected_args,
                  result.actual_response,
                  result.tool_called,
                  result.tool_correct,
                  result.args_correct,
                  result.args_score,
                  result.latency_ms,
                  result.error
                )
                .run(),
            catch: (e) => new DbError({ message: String(e) }),
          }).pipe(Effect.asVoid),
      } as unknown as Db
    )
}
