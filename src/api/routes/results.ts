/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { Effect } from "effect"
import { Db } from "../../services/Db.js"

const app = new Hono<{ Bindings: { DB: D1Database } }>()

app.get("/:id/results", async (c) => {
  const id = c.req.param("id")

  const result = await Effect.gen(function* () {
    const db = yield* Db
    const run = yield* db.getRun(id)
    if (!run) {
      return c.json({ error: "Run not found" }, 404 as const)
    }
    const results = yield* db.getResults(id)

    const total = results.length
    const errorCount = results.filter((r) => r.error !== null).length
    const toolCorrect = results.filter((r) => r.tool_correct === 1).length
    const argsCorrect = results.filter((r) => r.args_correct === 1).length
    const avgArgsScore = results.length > 0
      ? Math.round((results.reduce((sum, r) => sum + (r.args_score ?? 0), 0) / results.length) * 100)
      : 0
    const latencies = results
      .filter((r) => r.latency_ms !== null)
      .map((r) => r.latency_ms!)
    const avgLatency =
      latencies.length > 0
        ? Math.round(
            latencies.reduce((a, b) => a + b, 0) / latencies.length
          )
        : 0

    return c.json({
      run_id: id,
      status: run.status,
      summary: {
        total,
        tool_correct: toolCorrect,
        args_correct: argsCorrect,
        avg_args_score: avgArgsScore,
        errors: errorCount,
        avg_latency_ms: avgLatency,
      },
      results: results.map((r) => ({
        prompt_index: r.prompt_index,
        prompt: r.prompt,
        expected_tool: r.expected_tool,
        tool_called: r.tool_called,
        tool_correct: r.tool_correct === 1,
        args_correct: r.args_correct === 1,
        args_score: r.args_score ?? 0,
        latency_ms: r.latency_ms,
        error: r.error,
      })),
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
