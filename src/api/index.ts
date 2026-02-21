/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { cors } from "hono/cors"
import modelsRoute from "./routes/models.js"
import benchmarksRoute from "./routes/benchmarks.js"
import runsRoute from "./routes/runs.js"
import resultsRoute from "./routes/results.js"

export interface Env {
  DB: D1Database
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LOADER?: any
  CF_ACCOUNT_ID: string
  CF_API_TOKEN: string
  CF_EMAIL: string
  CF_API_KEY: string
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

app.route("/api/models", modelsRoute)
app.route("/api/benchmarks", benchmarksRoute)
app.route("/api/runs", runsRoute)
app.route("/api/runs", resultsRoute)

// Static assets and SPA fallback handled by the assets binding in wrangler.jsonc

export default app
