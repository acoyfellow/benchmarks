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
 * Required: /ai/v1/chat/completions does NOT normalize tool input —
 * GLM (and other OpenAI-compat models) reject flat format with 8001.
 */
function wrapTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

/** Response shape from /ai/v1/chat/completions (consistent across all models) */
interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{
        function?: { name: string; arguments: string }
      }>
      content?: string | null
    }
  }>
}

/**
 * Parse the normalized /ai/v1/chat/completions response.
 */
function parseResponse(raw: ChatCompletionResponse): AiToolCallResult {
  const msg = raw.choices?.[0]?.message
  if (msg?.tool_calls && msg.tool_calls.length > 0) {
    return {
      tool_calls: msg.tool_calls.map((tc) => ({
        name: tc.function?.name ?? "",
        arguments: typeof tc.function?.arguments === "string"
          ? JSON.parse(tc.function.arguments) as Record<string, unknown>
          : {},
      })),
    }
  }
  return { response: msg?.content ?? JSON.stringify(raw) }
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
  /**
   * Uses /ai/v1/chat/completions for normalized OpenAI-compatible responses.
   * Input tools are wrapped in OpenAI format (not normalized by the API).
   * Output is always choices[].message.tool_calls format (normalized by the API).
   */
  static layer = (accountId: string, opts: { email: string; apiKey: string }) =>
    Layer.succeed(
      WorkersAi,
      {
        run: (modelId: string, messages: Array<{ role: string; content: string }>, tools: ToolDef[]) =>
          Effect.tryPromise({
            try: async () => {
              const resp = await fetch(
                `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
                {
                  method: "POST",
                  headers: {
                    "X-Auth-Email": opts.email,
                    "X-Auth-Key": opts.apiKey,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    model: modelId,
                    messages,
                    tools: wrapTools(tools),
                  }),
                }
              )
              const json = (await resp.json()) as { result?: ChatCompletionResponse; success?: boolean; errors?: Array<{ message: string }> } & ChatCompletionResponse

              // REST API wraps in {result, success, errors} envelope
              const data = json.result ?? json
              if (json.success === false && json.errors?.length) {
                throw new Error(json.errors[0].message)
              }
              return parseResponse(data as ChatCompletionResponse)
            },
            catch: (e) => new Error(String(e)),
          }),
      } as unknown as WorkersAi
    )
}
