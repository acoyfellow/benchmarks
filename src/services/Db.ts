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
  latency_ms: number | null
  error: string | null
  created_at: number
}

export class Db extends Effect.Service<Db>()("Db", {
  effect: Effect.gen(function* () {
    return {
      getBenchmarks: Effect.fn("Db.getBenchmarks")(function* () {
        return [] as BenchmarkDefinition[]
      }),
      getBenchmark: Effect.fn("Db.getBenchmark")(function* (_id: string) {
        return null as BenchmarkDefinition | null
      }),
      createRun: Effect.fn("Db.createRun")(function* (run: {
        id: string
        benchmark_id: string
        model_id: string
      }) {
        return run
      }),
      getRun: Effect.fn("Db.getRun")(function* (_id: string) {
        return null as Run | null
      }),
      updateRunStatus: Effect.fn("Db.updateRunStatus")(function* (
        _id: string,
        _status: string,
        _timestamps?: { started_at?: number; completed_at?: number }
      ) {
        return undefined
      }),
      getResults: Effect.fn("Db.getResults")(function* (_runId: string) {
        return [] as Result[]
      }),
      insertResult: Effect.fn("Db.insertResult")(function* (_result: Result) {
        return undefined
      }),
    }
  }),
}) {
  static layer = (db: D1Database) =>
    Layer.effect(
      Db,
      Effect.gen(function* () {
        return {
          getBenchmarks: Effect.fn("Db.getBenchmarks")(function* () {
            return yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare("SELECT * FROM benchmark_definitions")
                  .all<BenchmarkDefinition>()
                  .then((r) => r.results),
              catch: (e) => new DbError({ message: String(e) }),
            })
          }),

          getBenchmark: Effect.fn("Db.getBenchmark")(function* (id: string) {
            return yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare("SELECT * FROM benchmark_definitions WHERE id = ?")
                  .bind(id)
                  .first<BenchmarkDefinition>(),
              catch: (e) => new DbError({ message: String(e) }),
            })
          }),

          createRun: Effect.fn("Db.createRun")(function* (run: {
            id: string
            benchmark_id: string
            model_id: string
          }) {
            yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare(
                    "INSERT INTO runs (id, benchmark_id, model_id, status) VALUES (?, ?, ?, 'pending')"
                  )
                  .bind(run.id, run.benchmark_id, run.model_id)
                  .run(),
              catch: (e) => new DbError({ message: String(e) }),
            })
            return run
          }),

          getRun: Effect.fn("Db.getRun")(function* (id: string) {
            return yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare("SELECT * FROM runs WHERE id = ?")
                  .bind(id)
                  .first<Run>(),
              catch: (e) => new DbError({ message: String(e) }),
            })
          }),

          updateRunStatus: Effect.fn("Db.updateRunStatus")(function* (
            id: string,
            status: string,
            timestamps?: { started_at?: number; completed_at?: number }
          ) {
            if (timestamps?.started_at !== undefined) {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .prepare(
                      "UPDATE runs SET status = ?, started_at = ? WHERE id = ?"
                    )
                    .bind(status, timestamps.started_at, id)
                    .run(),
                catch: (e) => new DbError({ message: String(e) }),
              })
            } else if (timestamps?.completed_at !== undefined) {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .prepare(
                      "UPDATE runs SET status = ?, completed_at = ? WHERE id = ?"
                    )
                    .bind(status, timestamps.completed_at, id)
                    .run(),
                catch: (e) => new DbError({ message: String(e) }),
              })
            } else {
              yield* Effect.tryPromise({
                try: () =>
                  db
                    .prepare("UPDATE runs SET status = ? WHERE id = ?")
                    .bind(status, id)
                    .run(),
                catch: (e) => new DbError({ message: String(e) }),
              })
            }
          }),

          getResults: Effect.fn("Db.getResults")(function* (runId: string) {
            return yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare(
                    "SELECT * FROM results WHERE run_id = ? ORDER BY prompt_index"
                  )
                  .bind(runId)
                  .all<Result>()
                  .then((r) => r.results),
              catch: (e) => new DbError({ message: String(e) }),
            })
          }),

          insertResult: Effect.fn("Db.insertResult")(function* (
            result: Result
          ) {
            yield* Effect.tryPromise({
              try: () =>
                db
                  .prepare(
                    `INSERT INTO results (id, run_id, prompt_index, prompt, expected_tool, expected_args, actual_response, tool_called, tool_correct, args_correct, latency_ms, error)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
                    result.latency_ms,
                    result.error
                  )
                  .run(),
              catch: (e) => new DbError({ message: String(e) }),
            })
          }),
        } as unknown as Db
      })
    )
}
