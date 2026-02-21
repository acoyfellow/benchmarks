/// <reference types="@cloudflare/workers-types" />
import { Hono } from "hono"
import { Effect } from "effect"
import { Db } from "../../services/Db.js"

const app = new Hono<{ Bindings: { DB: D1Database } }>()

app.get("/", async (c) => {
  const result = await Effect.gen(function* () {
    const db = yield* Db
    const benchmarks = yield* db.getBenchmarks()
    return {
      benchmarks: benchmarks.map((b) => ({
        id: b.id,
        name: b.name,
        type: b.type,
        description: b.description,
      })),
    }
  }).pipe(
    Effect.provide(Db.layer(c.env.DB)),
    Effect.catchAll((e) =>
      Effect.succeed({ benchmarks: [] as never[], error: String(e) })
    ),
    Effect.runPromise
  )

  return c.json(result)
})

export default app
