/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { Effect, Layer } from "effect"
import { Db } from "../../services/Db.js"
import { WorkersAi } from "../../services/WorkersAi.js"
import { orchestrateBenchmarkRun } from "../../runner/orchestrator.js"

const app = new Hono<{ Bindings: { DB: D1Database; CF_ACCOUNT_ID: string; CF_EMAIL: string; CF_API_KEY: string } }>()

function isRunBody(
  value: unknown
): value is { benchmark_id: string; model_id: string } {
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

app.post("/", async (c) => {
  const body = await c.req.json().catch(() => null)

  if (!isRunBody(body)) {
    return c.json({ error: "benchmark_id and model_id are required strings" }, 400)
  }

  const { benchmark_id, model_id } = body
  const runId = crypto.randomUUID()

  const response = await Effect.gen(function* () {
    const db = yield* Db
    yield* db.createRun({
      id: runId,
      benchmark_id,
      model_id,
    })
    return c.json({ run_id: runId, status: "pending" }, 201 as const)
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed(c.json({ error: String(e) }, 500 as const))
    ),
    Effect.runPromise
  )

  // Kick off orchestration — attached to the worker execution context so it
  // survives the response returning to the client.
  const AppLayer = Layer.mergeAll(
    Db.layer(c.env.DB),
    WorkersAi.layer(c.env.CF_ACCOUNT_ID, { email: c.env.CF_EMAIL, apiKey: c.env.CF_API_KEY })
  )

  const orchestrationEffect = orchestrateBenchmarkRun(
    runId,
    benchmark_id,
    model_id
  ).pipe(
    Effect.provide(AppLayer),
    Effect.tapError((e) =>
      Effect.sync(() => {
        console.error("Failed to orchestrate benchmark run", {
          runId,
          benchmarkId: benchmark_id,
          modelId: model_id,
          error: String(e),
        })
      })
    ),
    Effect.ignore
  )

  if (c.executionCtx) {
    c.executionCtx.waitUntil(Effect.runPromise(orchestrationEffect))
  } else {
    Effect.runFork(orchestrationEffect)
  }

  return response
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
    Effect.catchAll((e) => {
      const message = e instanceof Error ? e.message : String(e)
      return Effect.succeed(c.json({ error: message }, 500 as const))
    }),
    Effect.runPromise
  )

  return result
})

export default app
