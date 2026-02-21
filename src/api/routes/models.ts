import { Hono } from "hono"
import { Effect } from "effect"
import { CfModelsApi } from "../../services/CfModelsApi.js"

const app = new Hono<{
  Bindings: { CF_ACCOUNT_ID: string; CF_API_TOKEN: string; CF_EMAIL: string; CF_API_KEY: string }
}>()

app.get("/", async (c) => {
  const result = await Effect.gen(function* () {
    const api = yield* CfModelsApi
    const models = yield* api.listModels()

    const filtered = models
      .filter((m) => m.task?.name === "Text Generation")
      .map((m) => ({
        id: m.name,
        name: m.name,
      }))

    return { models: filtered }
  }).pipe(
    Effect.provide(
      CfModelsApi.layer(c.env.CF_ACCOUNT_ID, c.env.CF_API_TOKEN, {
        email: c.env.CF_EMAIL,
        apiKey: c.env.CF_API_KEY,
      })
    ),
    Effect.catchAll((e) => Effect.succeed({ models: [], error: String(e) })),
    Effect.runPromise
  )

  return c.json(result)
})

export default app
