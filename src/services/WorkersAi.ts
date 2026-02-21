/// <reference types="@cloudflare/workers-types" />
import { Effect, Layer } from "effect"

export interface ToolDef {
  name: string
  description: string
  parameters: unknown
}

export interface AiToolCallResult {
  tool_calls?: Array<{ name: string; arguments: Record<string, unknown> }>
  response?: string
}

export class WorkersAi extends Effect.Service<WorkersAi>()("WorkersAi", {
  effect: Effect.gen(function* () {
    return {
      run: Effect.fn("WorkersAi.run")(function* (
        _modelId: string,
        _messages: Array<{ role: string; content: string }>,
        _tools: ToolDef[]
      ) {
        return yield* Effect.succeed({} as AiToolCallResult)
      }),
    }
  }),
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static layer = (ai: any) =>
    Layer.effect(
      WorkersAi,
      Effect.gen(function* () {
        return {
          run: Effect.fn("WorkersAi.run")(function* (
            modelId: string,
            messages: Array<{ role: string; content: string }>,
            tools: ToolDef[]
          ) {
            return yield* Effect.tryPromise({
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              try: () => ai.run(modelId, { messages, tools }) as Promise<AiToolCallResult>,
              catch: (e) => new Error(String(e)),
            })
          }),
        } as unknown as WorkersAi
      })
    )
}
