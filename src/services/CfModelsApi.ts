import { HttpClient, FetchHttpClient } from "@effect/platform"
import { Effect, Layer } from "effect"
import { ApiError } from "../errors/index.js"

export interface CfModel {
  id: string
  name: string
  task?: { name: string }
  capabilities?: { tools?: boolean }
}

// In-memory cache scoped to a single worker instance.
// Note: This cache is lost on every cold start and is not shared across instances.
// If you need a persistent, cross-instance cache of models, use Cache API or KV instead.
let modelsCache: CfModel[] | null = null

export class CfModelsApi extends Effect.Service<CfModelsApi>()("CfModelsApi", {
  effect: Effect.gen(function* () {
    return {
      // Stub: override with CfModelsApi.layer(accountId, apiToken) at the Hono edge
      listModels: Effect.fn("CfModelsApi.listModels")(function* () {
        return [] as CfModel[]
      }),
    }
  }),
}) {
  static layer = (accountId: string, apiToken: string, opts?: { email?: string; apiKey?: string }) =>
    Layer.effect(
      CfModelsApi,
      Effect.gen(function* () {
        const http = yield* HttpClient.HttpClient

        // Use global API key auth if email+key provided, otherwise Bearer token
        const authHeaders: Record<string, string> = opts?.email && opts?.apiKey
          ? { "X-Auth-Email": opts.email, "X-Auth-Key": opts.apiKey }
          : { Authorization: `Bearer ${apiToken}` }

        return {
          listModels: Effect.fn("CfModelsApi.listModels")(function* () {
            if (modelsCache !== null) {
              return modelsCache
            }

            const raw = yield* http
              .get(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
                { headers: authHeaders }
              )
              .pipe(
                Effect.flatMap((resp) => resp.json),
                Effect.scoped,
                Effect.mapError(
                  (e) => new ApiError({ message: String(e), status: 500 })
                )
              )

            const data = raw as { success: boolean; result: CfModel[] }
            modelsCache = data.result ?? []
            return modelsCache
          }),
        } as unknown as CfModelsApi
      })
    ).pipe(Layer.provide(FetchHttpClient.layer))
}
