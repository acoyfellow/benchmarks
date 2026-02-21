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

function isLoaderMessage(value: unknown): value is LoaderMessage {
  if (value === null || typeof value !== "object") {
    return false
  }

  const msg = value as { [key: string]: unknown }

  return (
    typeof msg.runId === "string" &&
    typeof msg.benchmarkId === "string" &&
    typeof msg.modelId === "string"
  )
}

export default {
  async fetch(request: Request, env: LoaderEnv): Promise<Response> {
    const body = await request.json().catch(() => null)

    if (!isLoaderMessage(body)) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    }

    const { runId, benchmarkId, modelId } = body

    const AppLayer = Layer.mergeAll(Db.layer(env.DB), WorkersAi.layer(env.AI))

    try {
      await orchestrateBenchmarkRun(runId, benchmarkId, modelId).pipe(
        Effect.provide(AppLayer),
        Effect.runPromise
      )

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      })
    } catch (error) {
      console.error("Failed to orchestrate benchmark run", error)

      return new Response(
        JSON.stringify({
          ok: false,
          error: "Failed to orchestrate benchmark run",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }
      )
    }
  },
}
