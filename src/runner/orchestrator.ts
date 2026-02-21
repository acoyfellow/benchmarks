import { Effect } from "effect"
import { Db } from "../services/Db.js"
import { RunFailed, BenchmarkNotFound } from "../errors/index.js"
import { runToolBenchmark, type BenchmarkConfig } from "./tool-benchmark.js"

export const orchestrateBenchmarkRun = Effect.fn("orchestrateBenchmarkRun")(
  function* (runId: string, benchmarkId: string, modelId: string) {
    const db = yield* Db
    const now = Math.floor(Date.now() / 1000)

    yield* db.updateRunStatus(runId, "running", { started_at: now })

    const benchmark = yield* db.getBenchmark(benchmarkId).pipe(
      Effect.flatMap((b) =>
        b === null
          ? Effect.fail(new BenchmarkNotFound({ benchmarkId }))
          : Effect.succeed(b)
      ),
      Effect.catchTag("BenchmarkNotFound", () =>
        Effect.fail(new RunFailed({ runId, reason: "benchmark not found" }))
      )
    )

    const config = JSON.parse(benchmark.config) as BenchmarkConfig

    yield* runToolBenchmark(runId, modelId, config).pipe(
      Effect.catchAll((e) =>
        Effect.gen(function* () {
          yield* db.updateRunStatus(runId, "failed", {
            completed_at: Math.floor(Date.now() / 1000),
          })
          yield* Effect.logError(`Run ${runId} failed: ${String(e)}`)
        })
      )
    )

    yield* db.updateRunStatus(runId, "complete", {
      completed_at: Math.floor(Date.now() / 1000),
    })
    yield* Effect.logInfo(`Run ${runId} complete`)
  }
)
