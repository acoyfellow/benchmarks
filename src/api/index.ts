/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { cors } from "hono/cors"
import { Effect } from "effect"
import { Db } from "../services/Db.js"
import modelsRoute from "./routes/models.js"
import benchmarksRoute from "./routes/benchmarks.js"
import runsRoute from "./routes/runs.js"
import resultsRoute from "./routes/results.js"

export interface Env {
  DB: D1Database
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: any
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
  CF_EMAIL: string
  CF_API_KEY: string
  BENCHMARK_WORKFLOW: Workflow
}

const app = new Hono<{ Bindings: Env }>()

const allowedOrigins = ["https://benchmarks.coey.dev"]

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) {
        // No Origin header (same-origin or curl): return empty string so the
        // middleware sets no Access-Control-Allow-Origin header, which is correct
        // for same-origin requests.
        return ""
      }
      // Return the origin to allow it, or empty string to deny cross-origin access.
      return allowedOrigins.includes(origin) ? origin : ""
    },
  })
)

app.get("/api/leaderboard", async (c) => {
  const result = await Effect.gen(function* () {
    const db = yield* Db
    const entries = yield* db.getLeaderboard()
    return { leaderboard: entries }
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed({ leaderboard: [], error: String(e) })
    ),
    Effect.runPromise
  )
  return c.json(result)
})

app.get("/api/models/:modelId/stats", async (c) => {
  const modelId = c.req.param("modelId")
  const result = await Effect.gen(function* () {
    const db = yield* Db
    const runScores = yield* db.getModelRunScores(decodeURIComponent(modelId))
    const latencies = yield* db.getModelLatencies(decodeURIComponent(modelId))
    return { model_id: decodeURIComponent(modelId), runs: runScores, latencies }
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed({ model_id: modelId, runs: [], latencies: [], error: String(e) })
    ),
    Effect.runPromise
  )
  return c.json(result)
})

app.route("/api/models", modelsRoute)
app.route("/api/benchmarks", benchmarksRoute)
app.route("/api/runs", runsRoute)
app.route("/api/runs", resultsRoute)

// Static assets and SPA fallback handled by the assets binding in wrangler.jsonc

export default app

// Re-export workflow class so wrangler can find it
export { BenchmarkWorkflow } from "../runner/workflow.js"
