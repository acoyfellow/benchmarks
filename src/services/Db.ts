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
  runs: number
  avg_tool_pct: number
  avg_args_pct: number
  avg_args_score: number
  avg_latency_ms: number
  best_tool_pct: number
  best_run_id: string
}

interface DbMethods {
  getBenchmarks: () => Effect.Effect<BenchmarkDefinition[], DbError>
  getBenchmark: (id: string) => Effect.Effect<BenchmarkDefinition | null, DbError>
  createRun: (run: {
    id: string
    benchmark_id: string
    model_id: string
  }) => Effect.Effect<{ id: string; benchmark_id: string; model_id: string }, DbError>
  getRun: (id: string) => Effect.Effect<Run | null, DbError>
  updateRunStatus: (
    id: string,
    status: string,
    timestamps?: { started_at?: number; completed_at?: number }
  ) => Effect.Effect<void, DbError>
  listRuns: (limit?: number) => Effect.Effect<Run[], DbError>
  getLeaderboard: () => Effect.Effect<LeaderboardEntry[], DbError>
  getResults: (runId: string) => Effect.Effect<Result[], DbError>
  insertResult: (result: Result) => Effect.Effect<void, DbError>
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
    getLeaderboard: () => Effect.fail(notInitialized()),
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
          benchmark_id: string
          model_id: string
        }) =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  "INSERT INTO runs (id, benchmark_id, model_id, status) VALUES (?, ?, ?, 'pending')"
                )
                .bind(run.id, run.benchmark_id, run.model_id)
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

        getLeaderboard: () =>
          Effect.tryPromise({
            try: () =>
              db
                .prepare(
                  `SELECT
                    r.model_id,
                    COUNT(DISTINCT r.id) as runs,
                    ROUND(AVG(sub.tool_pct)) as avg_tool_pct,
                    ROUND(AVG(sub.args_pct)) as avg_args_pct,
                    ROUND(AVG(sub.avg_args_score) * 100) as avg_args_score,
                    ROUND(AVG(sub.avg_lat)) as avg_latency_ms,
                    MAX(sub.tool_pct) as best_tool_pct,
                    sub.best_run_id
                  FROM runs r
                  JOIN (
                    SELECT
                      run_id,
                      ROUND(100.0 * SUM(tool_correct) / COUNT(*)) as tool_pct,
                      ROUND(100.0 * SUM(args_correct) / COUNT(*)) as args_pct,
                      AVG(args_score) as avg_args_score,
                      AVG(latency_ms) as avg_lat,
                      run_id as best_run_id
                    FROM results
                    WHERE error IS NULL
                    GROUP BY run_id
                    HAVING COUNT(*) > 0
                  ) sub ON r.id = sub.run_id
                  WHERE r.status = 'complete'
                  GROUP BY r.model_id
                  ORDER BY avg_tool_pct DESC, avg_args_pct DESC, avg_latency_ms ASC`
                )
                .all<LeaderboardEntry>()
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
