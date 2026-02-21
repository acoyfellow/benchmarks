import { Hono } from "hono"
import { Effect } from "effect"
import { CfModelsApi } from "../../services/CfModelsApi.js"

const app = new Hono<{
  Bindings: { CF_ACCOUNT_ID: string; CF_API_TOKEN: string }
}>()

app.get("/", async (c) => {
  const accountId = c.env.CF_ACCOUNT_ID
  const apiToken = c.env.CF_API_TOKEN

  const result = await Effect.gen(function* () {
    const api = yield* CfModelsApi
    const models = yield* api.listModels(accountId, apiToken)

    const filtered = models
      .filter((m) => m.task?.name === "Text Generation")
      .map((m) => ({
        id: m.id,
        name: m.name,
        supports_tools: true,
      }))

    return { models: filtered }
  }).pipe(
    Effect.provide(CfModelsApi.Default),
    Effect.catchAll((e) => Effect.succeed({ models: [], error: String(e) })),
    Effect.runPromise
  )

  return c.json(result)
})

export default app
