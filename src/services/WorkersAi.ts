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

/**
 * Wrap flat tool defs into OpenAI-style format.
 * Llama models accept both formats; GLM/OpenAI-compat models require this.
 */
function wrapTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

/**
 * Normalize AI response into our flat format.
 * Handles both:
 *   - Llama-style:  { tool_calls: [{ name, arguments: {...} }] }
 *   - OpenAI-style: { choices: [{ message: { tool_calls: [{ function: { name, arguments: "json" } }] } }] }
 */
function normalizeResponse(raw: Record<string, unknown>): AiToolCallResult {
  // OpenAI-style: choices[0].message.tool_calls
  const choices = raw.choices as Array<{ message?: { tool_calls?: Array<{ function?: { name: string; arguments: string } }> } }> | undefined
  if (choices && choices.length > 0) {
    const msg = choices[0]?.message
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      return {
        tool_calls: msg.tool_calls.map((tc) => ({
          name: tc.function?.name ?? "",
          arguments: typeof tc.function?.arguments === "string"
            ? JSON.parse(tc.function.arguments) as Record<string, unknown>
            : (tc.function?.arguments as unknown as Record<string, unknown>) ?? {},
        })),
      }
    }
    return { response: JSON.stringify(raw) }
  }

  // Llama-style: flat tool_calls
  const calls = raw.tool_calls as Array<{ name: string; arguments: Record<string, unknown> }> | undefined
  if (calls && calls.length > 0) {
    return { tool_calls: calls }
  }

  return { response: (raw.response as string | undefined) ?? JSON.stringify(raw) }
}

export class WorkersAi extends Effect.Service<WorkersAi>()("WorkersAi", {
  effect: Effect.gen(function* () {
    return {
      run: Effect.fn("WorkersAi.run")(function* (
        _modelId: string,
        _messages: Array<{ role: string; content: string }>,
        _tools: ToolDef[]
      ) {
        return { tool_calls: [], response: "" } as AiToolCallResult
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
            const wrappedTools = wrapTools(tools)
            return yield* Effect.async<AiToolCallResult, Error>((resume) => {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
              ;(ai.run(modelId, { messages, tools: wrappedTools }) as Promise<Record<string, unknown>>).then(
                (raw) => resume(Effect.succeed(normalizeResponse(raw))),
                (e) => resume(Effect.fail(new Error(String(e))))
              )
            })
          }),
        } as unknown as WorkersAi
      })
    )
}
