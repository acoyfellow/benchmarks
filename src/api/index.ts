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
}

const app = new Hono<{ Bindings: Env }>()

const allowedOrigins = ["https://benchmarks.coey.dev"]

app.use(
  "/api/*",
  cors({
    origin: (origin) => {
      if (!origin) {
        // No Origin header (same-origin or curl): do not set CORS header
        return ""
      }
      return allowedOrigins.includes(origin) ? origin : ""
    },
  })
)

app.route("/api/models", modelsRoute)
app.route("/api/benchmarks", benchmarksRoute)
app.route("/api/runs", runsRoute)
app.route("/api/runs", resultsRoute)

// Serve static assets / SPA fallback
app.get("*", async (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Benchmarks — Workers AI</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/assets/main.js"></script>
</body>
</html>`)
})

export default app
