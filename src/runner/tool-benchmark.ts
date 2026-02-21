import { Effect } from "effect"
import { Db, type Result } from "../services/Db.js"
import { WorkersAi, type ToolDef } from "../services/WorkersAi.js"
import { RunFailed } from "../errors/index.js"

export interface BenchmarkConfig {
  tools: ToolDef[]
  test_cases: Array<{
    prompt: string
    expected_tool: string
    expected_args: Record<string, unknown>
  }>
}

function checkArgsMatch(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>
): boolean {
  for (const [key, val] of Object.entries(expected)) {
    if (!(key in actual)) return false
    const actualVal = String(actual[key]).toLowerCase()
    const expectedVal = String(val).toLowerCase()
    if (!actualVal.includes(expectedVal) && !expectedVal.includes(actualVal))
      return false
  }
  return true
}

export const runToolBenchmark = Effect.fn("runToolBenchmark")(function* (
  runId: string,
  modelId: string,
  config: BenchmarkConfig
) {
  const db = yield* Db
  const ai = yield* WorkersAi

  for (let i = 0; i < config.test_cases.length; i++) {
    const testCase = config.test_cases[i]
    const start = Date.now()

    const resultId = crypto.randomUUID()
    let toolCalled: string | null = null
    let toolCorrect = 0
    let argsCorrect = 0
    let latencyMs: number | null = null
    let errorMsg: string | null = null
    let actualResponse: string | null = null

    const aiResult = yield* ai
      .run(modelId, [{ role: "user", content: testCase.prompt }], config.tools)
      .pipe(
        Effect.mapError((e) => new RunFailed({ runId, reason: String(e) })),
        Effect.catchAll((e) => {
          errorMsg = e.reason
          return Effect.succeed(null)
        })
      )

    latencyMs = Date.now() - start

    if (aiResult !== null) {
      actualResponse = JSON.stringify(aiResult)
      if (aiResult.tool_calls && aiResult.tool_calls.length > 0) {
        const call = aiResult.tool_calls[0]
        toolCalled = call.name
        toolCorrect = call.name === testCase.expected_tool ? 1 : 0
        if (toolCorrect && testCase.expected_args) {
          argsCorrect = checkArgsMatch(testCase.expected_args, call.arguments)
            ? 1
            : 0
        }
      }
    }

    const result: Result = {
      id: resultId,
      run_id: runId,
      prompt_index: i,
      prompt: testCase.prompt,
      expected_tool: testCase.expected_tool,
      expected_args: JSON.stringify(testCase.expected_args),
      actual_response: actualResponse,
      tool_called: toolCalled,
      tool_correct: toolCorrect,
      args_correct: argsCorrect,
      latency_ms: latencyMs,
      error: errorMsg,
      created_at: Math.floor(Date.now() / 1000),
    }

    yield* db.insertResult(result)
    yield* Effect.logInfo(
      `Result ${i + 1}/${config.test_cases.length}: tool_correct=${toolCorrect}, latency=${latencyMs}ms`
    )
  }
})
