/// <reference types="@cloudflare/workers-types" />
import { Effect, Layer } from "effect"
import { Db } from "../services/Db.js"
import { WorkersAi } from "../services/WorkersAi.js"
import { orchestrateBenchmarkRun } from "../runner/orchestrator.js"

export interface LoaderEnv {
  DB: D1Database
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AI: any
}

export interface LoaderMessage {
  runId: string
  benchmarkId: string
  modelId: string
}

export default {
  async fetch(request: Request, env: LoaderEnv): Promise<Response> {
    const msg = (await request.json()) as LoaderMessage
    const { runId, benchmarkId, modelId } = msg

    const AppLayer = Layer.mergeAll(Db.layer(env.DB), WorkersAi.layer(env.AI))

    await orchestrateBenchmarkRun(runId, benchmarkId, modelId).pipe(
      Effect.provide(AppLayer),
      Effect.runPromise
    )

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    })
  },
}
