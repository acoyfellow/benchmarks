/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { Effect, Layer } from "effect"
import { Db } from "../../services/Db.js"
import { WorkersAi } from "../../services/WorkersAi.js"
import { orchestrateBenchmarkRun } from "../../runner/orchestrator.js"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const app = new Hono<{ Bindings: { DB: D1Database; AI: any; LOADER?: any } }>()

app.post("/", async (c) => {
  const body = (await c.req.json()) as {
    benchmark_id: string
    model_id: string
  }
  const runId = crypto.randomUUID()

  const result = await Effect.gen(function* () {
    const db = yield* Db
    yield* db.createRun({
      id: runId,
      benchmark_id: body.benchmark_id,
      model_id: body.model_id,
    })
    return { run_id: runId, status: "pending" }
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed({ run_id: runId, status: "error", error: String(e) })
    ),
    Effect.runPromise
  )

  // Kick off orchestration in background (non-blocking)
  const AppLayer = Layer.mergeAll(
    Db.layer(c.env.DB),
    WorkersAi.layer(c.env.AI)
  )

  Effect.runFork(
    orchestrateBenchmarkRun(runId, body.benchmark_id, body.model_id).pipe(
      Effect.provide(AppLayer)
    )
  )

  return c.json(result)
})

app.get("/:id", async (c) => {
  const id = c.req.param("id")

  const result = await Effect.gen(function* () {
    const db = yield* Db
    const run = yield* db.getRun(id)
    if (!run) {
      return c.json({ error: "Run not found" }, 404 as const)
    }
    return c.json({
      run_id: run.id,
      benchmark_id: run.benchmark_id,
      model_id: run.model_id,
      status: run.status,
      started_at: run.started_at,
      completed_at: run.completed_at,
    })
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed(c.json({ error: String(e) }, 500 as const))
    ),
    Effect.runPromise
  )

  return result
})

export default app
