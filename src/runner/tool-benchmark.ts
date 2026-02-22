import { Effect } from "effect"
import { Db, type Result } from "../services/Db.js"
import { WorkersAi, type ToolDef } from "../services/WorkersAi.js"
import { RunFailed } from "../errors/index.js"

export interface ArgExpectation {
  value: string
  match: "exact" | "contains" | "keywords"
}

export interface TestCase {
  prompt: string
  expected_tool: string
  expected_args: Record<string, ArgExpectation>
}

export interface BenchmarkConfig {
  tools: ToolDef[]
  test_cases: TestCase[]
}

interface ArgMatchDetail {
  key: string
  expected: string
  actual: string | undefined
  strategy: ArgExpectation["match"]
  matched: boolean
}

function matchArg(
  strategy: ArgExpectation["match"],
  expected: string,
  actual: string
): boolean {
  const e = expected.trim().toLowerCase()
  const a = actual.trim().toLowerCase()

  switch (strategy) {
    case "exact":
      return a === e

    case "contains":
      return a.includes(e)

    case "keywords": {
      const keywords = e.split(/\s+/).filter(Boolean)
      return keywords.every((kw) => a.includes(kw))
    }
  }
}

function scoreArgs(
  expected: Record<string, ArgExpectation>,
  actual: Record<string, unknown>
): { allMatch: boolean; score: number; details: ArgMatchDetail[] } {
  const entries = Object.entries(expected)
  if (entries.length === 0) {
    return { allMatch: true, score: 1.0, details: [] }
  }

  const details: ArgMatchDetail[] = []
  let matchedCount = 0

  for (const [key, expectation] of entries) {
    const actualRaw = actual[key]
    const actualStr = actualRaw !== undefined && actualRaw !== null
      ? String(actualRaw)
      : undefined

    const matched =
      actualStr !== undefined &&
      matchArg(expectation.match, expectation.value, actualStr)

    if (matched) matchedCount++

    details.push({
      key,
      expected: expectation.value,
      actual: actualStr,
      strategy: expectation.match,
      matched,
    })
  }

  const score = matchedCount / entries.length
  const allMatch = matchedCount === entries.length

  return { allMatch, score, details }
}

export const runToolBenchmark = Effect.fn("runToolBenchmark")(function* (
  runId: string,
  modelId: string,
  config: BenchmarkConfig
) {
  const db = yield* Db
  const ai = yield* WorkersAi

  yield* Effect.forEach(
    config.test_cases,
    (testCase, index) =>
      Effect.gen(function* () {
        const start = Date.now()

        const resultId = crypto.randomUUID()
        let toolCalled: string | null = null
        let toolCorrect = 0
        let argsCorrect = 0
        let argsScore = 0
        let latencyMs: number | null = null
        let errorMsg: string | null = null
        let actualResponse: string | null = null

        const aiResult = yield* ai
          .run(
            modelId,
            [{ role: "user", content: testCase.prompt }],
            config.tools
          )
          .pipe(
            // Capture latency immediately after the AI call succeeds
            Effect.tap(() =>
              Effect.sync(() => {
                latencyMs = Date.now() - start
              })
            ),
            Effect.mapError(
              (e) => new RunFailed({ runId, reason: String(e) })
            ),
            Effect.catchAll((e) => {
              errorMsg = e.reason
              return Effect.succeed(null)
            })
          )

        if (aiResult !== null) {
          let argMatchDetails: ArgMatchDetail[] | undefined

          if (aiResult.tool_calls && aiResult.tool_calls.length > 0) {
            const call = aiResult.tool_calls[0]
            toolCalled = call.name
            toolCorrect = call.name === testCase.expected_tool ? 1 : 0

            if (toolCorrect && testCase.expected_args) {
              const { allMatch, score, details } = scoreArgs(
                testCase.expected_args,
                call.arguments
              )
              argsCorrect = allMatch ? 1 : 0
              argsScore = Math.round(score * 1000) / 1000
              argMatchDetails = details
            }
          }

          actualResponse = JSON.stringify({
            ...aiResult,
            args_score: argsScore,
            arg_match_details: argMatchDetails ?? null,
          })
        }

        const result: Result = {
          id: resultId,
          run_id: runId,
          prompt_index: index,
          prompt: testCase.prompt,
          expected_tool: testCase.expected_tool,
          expected_args: JSON.stringify(testCase.expected_args),
          actual_response: actualResponse,
          tool_called: toolCalled,
          tool_correct: toolCorrect,
          args_correct: argsCorrect,
          args_score: argsScore,
          latency_ms: latencyMs,
          error: errorMsg,
          created_at: Math.floor(Date.now() / 1000),
        }

        yield* db.insertResult(result)
        yield* Effect.logInfo(
          `Result ${index + 1}/${config.test_cases.length}: tool_correct=${toolCorrect}, args_correct=${argsCorrect}, args_score=${argsScore}, latency=${latencyMs}ms`
        )
      }),
    { concurrency: 3 }
  )
})
