import { HttpClient, FetchHttpClient } from "@effect/platform"
import { Effect } from "effect"
import { ApiError } from "../errors/index.js"

export interface CfModel {
  id: string
  name: string
  task?: { name: string }
}

// In-memory cache for the worker lifetime
let modelsCache: CfModel[] | null = null

export class CfModelsApi extends Effect.Service<CfModelsApi>()("CfModelsApi", {
  dependencies: [FetchHttpClient.layer],
  effect: Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    return {
      listModels: Effect.fn("CfModelsApi.listModels")(function* (
        accountId: string,
        apiToken: string
      ) {
        if (modelsCache !== null) {
          return modelsCache
        }

        const raw = yield* http
          .get(
            `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/models/search`,
            { headers: { Authorization: `Bearer ${apiToken}` } }
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
    }
  }),
}) {}
