/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { Effect, Layer } from "effect"
import { Db } from "../../services/Db.js"
import { WorkersAi } from "../../services/WorkersAi.js"
import { orchestrateBatch } from "../../runner/orchestrator.js"

const DEFAULT_RUNS = 5

const app = new Hono<{ Bindings: { DB: D1Database; CF_ACCOUNT_ID: string; CF_EMAIL: string; CF_API_KEY: string } }>()

function isRunBody(
  value: unknown
): value is { benchmark_id: string; model_id: string; runs?: number } {
  if (value === null || typeof value !== "object") return false
  const v = value as Record<string, unknown>
  return typeof v.benchmark_id === "string" && typeof v.model_id === "string"
}

app.get("/", async (c) => {
  const limit = Number(c.req.query("limit") ?? "50")

  const result = await Effect.gen(function* () {
    const db = yield* Db
    const runs = yield* db.listRuns(limit)
    return c.json({ runs })
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed(c.json({ error: String(e), runs: [] }, 500 as const))
    ),
    Effect.runPromise
  )

  return result
})

// Create a batch of N runs
app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!isRunBody(body)) {
    return c.json({ error: "benchmark_id and model_id are required strings" }, 400)
  }

  const { benchmark_id, model_id } = body
  const numRuns = Math.min(Math.max(body.runs ?? DEFAULT_RUNS, 1), 10)
  const batchId = crypto.randomUUID()
  const runIds: string[] = []

  // Create all runs in DB
  const createResult = await Effect.gen(function* () {
    const db = yield* Db
    for (let i = 0; i < numRuns; i++) {
      const runId = crypto.randomUUID()
      runIds.push(runId)
      yield* db.createRun({
        id: runId,
        batch_id: batchId,
        benchmark_id,
        model_id,
      })
    }
    return c.json({
      batch_id: batchId,
      run_ids: runIds,
      total: numRuns,
      status: "pending",
    }, 201 as const)
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed(c.json({ error: String(e) }, 500 as const))
    ),
    Effect.runPromise
  )

  // Kick off batch sequentially — one run at a time to avoid timeout
  const AppLayer = Layer.mergeAll(
    Db.layer(c.env.DB),
    WorkersAi.layer(c.env.CF_ACCOUNT_ID, { email: c.env.CF_EMAIL, apiKey: c.env.CF_API_KEY })
  )

  const batchEffect = orchestrateBatch(
    runIds,
    benchmark_id,
    model_id
  ).pipe(
    Effect.provide(AppLayer),
    Effect.tapError((e) =>
      Effect.sync(() => {
        console.error("Batch failed", { batchId, error: String(e) })
      })
    ),
    Effect.ignore
  )

  if (c.executionCtx) {
    c.executionCtx.waitUntil(Effect.runPromise(batchEffect))
  } else {
    Effect.runFork(batchEffect)
  }

  return createResult
})

// Get batch status
app.get("/batch/:batchId", async (c) => {
  const batchId = c.req.param("batchId")

  const result = await Effect.gen(function* () {
    const db = yield* Db
    const status = yield* db.getBatchStatus(batchId)
    if (!status) {
      return c.json({ error: "Batch not found" }, 404 as const)
    }
    return c.json(status)
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed(c.json({ error: String(e) }, 500 as const))
    ),
    Effect.runPromise
  )

  return result
})

// List recent batches
app.get("/batches", async (c) => {
  const limit = Number(c.req.query("limit") ?? "20")

  const result = await Effect.gen(function* () {
    const db = yield* Db
    const batches = yield* db.listBatches(limit)
    return c.json({ batches })
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed(c.json({ error: String(e), batches: [] }, 500 as const))
    ),
    Effect.runPromise
  )

  return result
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
      batch_id: run.batch_id,
      benchmark_id: run.benchmark_id,
      model_id: run.model_id,
      status: run.status,
      started_at: run.started_at,
      completed_at: run.completed_at,
    })
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) => {
      const message = e instanceof Error ? e.message : String(e)
      return Effect.succeed(c.json({ error: message }, 500 as const))
    }),
    Effect.runPromise
  )

  return result
})

export default app
