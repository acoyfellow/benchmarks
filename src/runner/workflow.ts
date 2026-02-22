/// <reference types="@cloudflare/workers-types" />
import { WorkflowEntrypoint, type WorkflowStep, type WorkflowEvent } from "cloudflare:workers"

interface Env {
  DB: D1Database
  CF_ACCOUNT_ID: string
  CF_API_KEY: string
  CF_EMAIL: string
}

interface BenchmarkParams {
  batch_id: string
  run_ids: string[]
  benchmark_id: string
  model_id: string
}

interface ToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface ArgExpectation {
  value: string
  match: "exact" | "contains" | "keywords"
}

interface TestCase {
  prompt: string
  expected_tool: string
  expected_args: Record<string, ArgExpectation>
}

interface BenchmarkConfig {
  tools: ToolDef[]
  test_cases: TestCase[]
}

function wrapTools(tools: ToolDef[]): unknown[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

function matchArg(strategy: ArgExpectation["match"], expected: string, actual: string): boolean {
  const e = expected.trim().toLowerCase()
  const a = actual.trim().toLowerCase()
  switch (strategy) {
    case "exact": return a === e
    case "contains": return a.includes(e)
    case "keywords": return e.split(/\s+/).filter(Boolean).every((kw) => a.includes(kw))
  }
}

function scoreArgs(
  expected: Record<string, ArgExpectation>,
  actual: Record<string, unknown>
): { allMatch: boolean; score: number; details: Array<{ key: string; expected: string; actual: string | undefined; strategy: string; matched: boolean }> } {
  const entries = Object.entries(expected)
  if (entries.length === 0) return { allMatch: true, score: 1.0, details: [] }
  const details: Array<{ key: string; expected: string; actual: string | undefined; strategy: string; matched: boolean }> = []
  let matchedCount = 0
  for (const [key, exp] of entries) {
    const actualRaw = actual[key]
    const actualStr = actualRaw != null ? String(actualRaw) : undefined
    const matched = actualStr !== undefined && matchArg(exp.match, exp.value, actualStr)
    if (matched) matchedCount++
    details.push({ key, expected: exp.value, actual: actualStr, strategy: exp.match, matched })
  }
  return { allMatch: matchedCount === entries.length, score: matchedCount / entries.length, details }
}

export class BenchmarkWorkflow extends WorkflowEntrypoint<Env, BenchmarkParams> {
  async run(event: WorkflowEvent<BenchmarkParams>, step: WorkflowStep) {
    const { batch_id, run_ids, benchmark_id, model_id } = event.payload
    const db = this.env.DB

    // Step 1: Load benchmark config
    const configRaw = await step.do("load-config", async () => {
      const row = await db
        .prepare("SELECT config FROM benchmark_definitions WHERE id = ?")
        .bind(benchmark_id)
        .first<{ config: string }>()
      if (!row) throw new Error(`Benchmark ${benchmark_id} not found`)
      return row.config
    })
    const config = JSON.parse(configRaw as string) as BenchmarkConfig

    // Step 2: Run each run sequentially
    for (let runIdx = 0; runIdx < run_ids.length; runIdx++) {
      const runId = run_ids[runIdx]

      // Mark run as started
      await step.do(`run-${runIdx}-start`, async () => {
        await db
          .prepare("UPDATE runs SET status = 'running', started_at = ? WHERE id = ?")
          .bind(Math.floor(Date.now() / 1000), runId)
          .run()
      })

      let allSucceeded = true

      // Each prompt is its own step
      for (let pi = 0; pi < config.test_cases.length; pi++) {
        const tc = config.test_cases[pi]

        const ok = await step.do(`run-${runIdx}-prompt-${pi}`, {
          retries: { limit: 1, delay: "5 seconds" },
          timeout: "60 seconds",
        }, async () => {
          const start = Date.now()
          let toolCalled: string | null = null
          let toolCorrect = 0
          let argsCorrect = 0
          let argsScore = 0
          let latencyMs: number | null = null
          let errorMsg: string | null = null
          let actualResponse: string | null = null

          try {
            const resp = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${this.env.CF_ACCOUNT_ID}/ai/v1/chat/completions`,
              {
                method: "POST",
                headers: {
                  "X-Auth-Email": this.env.CF_EMAIL,
                  "X-Auth-Key": this.env.CF_API_KEY,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  model: model_id,
                  messages: [{ role: "user", content: tc.prompt }],
                  tools: wrapTools(config.tools),
                }),
              }
            )
            latencyMs = Date.now() - start
            const json = (await resp.json()) as Record<string, unknown>
            const data = (json.result ?? json) as {
              choices?: Array<{ message?: { tool_calls?: Array<{ function?: { name: string; arguments: string } }>; content?: string | null } }>
            }

            if ((json as { success?: boolean }).success === false) {
              const errors = (json as { errors?: Array<{ message: string }> }).errors
              throw new Error(errors?.[0]?.message ?? "API error")
            }

            const msg = data.choices?.[0]?.message
            if (msg?.tool_calls && msg.tool_calls.length > 0) {
              const call = msg.tool_calls[0]
              const name = call.function?.name ?? ""
              const args = typeof call.function?.arguments === "string"
                ? JSON.parse(call.function.arguments) as Record<string, unknown>
                : {}

              toolCalled = name
              toolCorrect = name === tc.expected_tool ? 1 : 0
              if (toolCorrect && tc.expected_args) {
                const { allMatch, score, details } = scoreArgs(tc.expected_args, args)
                argsCorrect = allMatch ? 1 : 0
                argsScore = Math.round(score * 1000) / 1000
                actualResponse = JSON.stringify({ tool_calls: [{ name, arguments: args }], args_score: argsScore, arg_match_details: details })
              } else {
                actualResponse = JSON.stringify({ tool_calls: [{ name, arguments: args }], args_score: 0, arg_match_details: null })
              }
            } else {
              actualResponse = JSON.stringify({ response: msg?.content ?? JSON.stringify(data), args_score: 0, arg_match_details: null })
            }
          } catch (e) {
            errorMsg = String(e)
            latencyMs = latencyMs ?? (Date.now() - start)
          }

          await db
            .prepare(
              `INSERT INTO results (id, run_id, prompt_index, prompt, expected_tool, expected_args, actual_response, tool_called, tool_correct, args_correct, args_score, latency_ms, error)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              crypto.randomUUID(), runId, pi, tc.prompt, tc.expected_tool,
              JSON.stringify(tc.expected_args), actualResponse, toolCalled,
              toolCorrect, argsCorrect, argsScore, latencyMs, errorMsg
            )
            .run()

          return errorMsg === null
        })

        if (!ok) allSucceeded = false
      }

      // Mark run complete
      await step.do(`run-${runIdx}-complete`, async () => {
        await db
          .prepare("UPDATE runs SET status = ?, completed_at = ? WHERE id = ?")
          .bind(allSucceeded ? "complete" : "failed", Math.floor(Date.now() / 1000), runId)
          .run()
      })
    }
  }
}
