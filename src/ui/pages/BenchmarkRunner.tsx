import React, { useEffect, useState, useCallback, useRef } from "react"

interface Model {
  id: string
  name: string
  supports_tools: boolean
}

interface Benchmark {
  id: string
  name: string
  type: string
  description: string | null
}

interface ResultRow {
  prompt_index: number
  prompt: string
  expected_tool: string
  tool_called: string | null
  tool_correct: boolean
  args_correct: boolean
  latency_ms: number | null
  error: string | null
}

interface RunSummary {
  total: number
  tool_correct: number
  args_correct: number
  avg_latency_ms: number
}

interface RunResults {
  run_id: string
  status: string
  summary: RunSummary
  results: ResultRow[]
}

export default function BenchmarkRunner() {
  const [models, setModels] = useState<Model[]>([])
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([])
  const [selectedModel, setSelectedModel] = useState("")
  const [selectedBenchmark, setSelectedBenchmark] = useState("")
  const [runId, setRunId] = useState<string | null>(null)
  const [runResults, setRunResults] = useState<RunResults | null>(null)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch("/api/models")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = (await r.json()) as { models?: Model[]; error?: string }
        if (d.error) throw new Error(d.error)
        setModels(d.models ?? [])
      })
      .catch((e) => setFetchError(`Failed to load models: ${String(e)}`))
    fetch("/api/benchmarks")
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const d = (await r.json()) as {
          benchmarks?: Benchmark[]
          error?: string
        }
        if (d.error) throw new Error(d.error)
        setBenchmarks(d.benchmarks ?? [])
      })
      .catch((e) => setFetchError(`Failed to load benchmarks: ${String(e)}`))
  }, [])

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const startPolling = useCallback(
    (rid: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/runs/${rid}/results`)
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const data: RunResults = (await r.json()) as RunResults
          setRunResults(data)
          setStatus(data.status)
          if (data.status !== "running" && data.status !== "pending") {
            stopPolling()
            setLoading(false)
          }
        } catch (e) {
          setFetchError(`Polling error: ${String(e)}`)
          stopPolling()
          setLoading(false)
        }
      }, 1500)
    },
    [stopPolling]
  )

  const handleRun = useCallback(async () => {
    if (!selectedModel || !selectedBenchmark) return
    setLoading(true)
    setRunResults(null)
    setStatus("pending")
    setFetchError(null)
    stopPolling()

    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmark_id: selectedBenchmark,
          model_id: selectedModel,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as { run_id: string; status: string }
      setRunId(data.run_id)
      setStatus(data.status)
      startPolling(data.run_id)
    } catch (e) {
      setFetchError(`Failed to start run: ${String(e)}`)
      setLoading(false)
      setStatus(null)
    }
  }, [selectedModel, selectedBenchmark, startPolling, stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const accuracy =
    runResults && runResults.summary.total > 0
      ? Math.round(
          (runResults.summary.tool_correct / runResults.summary.total) * 100
        )
      : 0

  return (
    <div
      style={{
        maxWidth: 900,
        margin: "0 auto",
        padding: "2rem",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <h1 style={{ fontSize: "1.8rem", marginBottom: "1.5rem" }}>
        Workers AI Benchmark
      </h1>

      {fetchError && (
        <div style={{ marginBottom: "1rem", padding: "0.75rem 1rem", background: "#f8d7da", color: "#721c24", borderRadius: 6, fontSize: "0.9rem" }}>
          {fetchError}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "1rem",
          alignItems: "flex-end",
          marginBottom: "2rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <label
            style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
          >
            Model
          </label>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            style={{
              padding: "0.5rem",
              minWidth: 280,
              borderRadius: 4,
              border: "1px solid #ccc",
            }}
          >
            <option value="">Select a model…</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            style={{ display: "block", marginBottom: 4, fontWeight: 600 }}
          >
            Benchmark
          </label>
          <select
            value={selectedBenchmark}
            onChange={(e) => setSelectedBenchmark(e.target.value)}
            style={{
              padding: "0.5rem",
              minWidth: 200,
              borderRadius: 4,
              border: "1px solid #ccc",
            }}
          >
            <option value="">Select a benchmark…</option>
            {benchmarks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={handleRun}
          disabled={loading || !selectedModel || !selectedBenchmark}
          style={{
            padding: "0.5rem 1.5rem",
            background: loading ? "#aaa" : "#0066ff",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: loading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {loading ? "Running…" : "Run Benchmark"}
        </button>
      </div>

      {status && (
        <div style={{ marginBottom: "1rem" }}>
          <span
            style={{
              display: "inline-block",
              padding: "0.25rem 0.75rem",
              borderRadius: 999,
              fontSize: "0.85rem",
              fontWeight: 600,
              background:
                status === "complete"
                  ? "#d4edda"
                  : status === "failed"
                    ? "#f8d7da"
                    : "#fff3cd",
              color:
                status === "complete"
                  ? "#155724"
                  : status === "failed"
                    ? "#721c24"
                    : "#856404",
            }}
          >
            {status.toUpperCase()}
          </span>
          {runId && (
            <span
              style={{ marginLeft: "1rem", fontSize: "0.8rem", color: "#888" }}
            >
              Run ID: {runId}
            </span>
          )}
        </div>
      )}

      {runResults && runResults.summary.total > 0 && (
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "#f8f9fa",
            borderRadius: 8,
          }}
        >
          <div
            style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}
          >
            <div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>
                Tool Accuracy
              </div>
              <div style={{ fontSize: "1.8rem", fontWeight: 700 }}>
                {accuracy}%
              </div>
              <div
                style={{
                  background: "#e9ecef",
                  borderRadius: 4,
                  height: 8,
                  width: 200,
                  marginTop: 4,
                }}
              >
                <div
                  style={{
                    background:
                      accuracy >= 80
                        ? "#28a745"
                        : accuracy >= 50
                          ? "#ffc107"
                          : "#dc3545",
                    height: 8,
                    borderRadius: 4,
                    width: `${accuracy}%`,
                    transition: "width 0.5s",
                  }}
                />
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>
                Tools Correct
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>
                {runResults.summary.tool_correct}/{runResults.summary.total}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>
                Args Correct
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>
                {runResults.summary.args_correct}/{runResults.summary.total}
              </div>
            </div>
            <div>
              <div style={{ fontSize: "0.8rem", color: "#666" }}>
                Avg Latency
              </div>
              <div style={{ fontSize: "1.4rem", fontWeight: 600 }}>
                {runResults.summary.avg_latency_ms}ms
              </div>
            </div>
          </div>
        </div>
      )}

      {runResults && runResults.results.length > 0 && (
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}
        >
          <thead>
            <tr style={{ background: "#f1f3f5" }}>
              {(
                [
                  ["#", "left"],
                  ["Prompt", "left"],
                  ["Expected", "left"],
                  ["Called", "left"],
                  ["Tool", "center"],
                  ["Args", "center"],
                  ["Latency", "right"],
                ] as [string, React.CSSProperties["textAlign"]][]
              ).map(([label, align]) => (
                <th
                  key={label}
                  style={{
                    padding: "0.5rem",
                    textAlign: align,
                    borderBottom: "2px solid #dee2e6",
                  }}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {runResults.results.map((row) => (
              <tr
                key={row.prompt_index}
                style={{ borderBottom: "1px solid #dee2e6" }}
              >
                <td style={{ padding: "0.5rem" }}>{row.prompt_index + 1}</td>
                <td
                  style={{
                    padding: "0.5rem",
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={row.prompt}
                >
                  {row.prompt}
                </td>
                <td
                  style={{
                    padding: "0.5rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {row.expected_tool}
                </td>
                <td
                  style={{
                    padding: "0.5rem",
                    fontFamily: "monospace",
                    fontSize: "0.8rem",
                  }}
                >
                  {row.tool_called ?? "—"}
                </td>
                <td style={{ padding: "0.5rem", textAlign: "center" }}>
                  <Badge pass={row.tool_correct} />
                </td>
                <td style={{ padding: "0.5rem", textAlign: "center" }}>
                  <Badge pass={row.args_correct} />
                </td>
                <td
                  style={{
                    padding: "0.5rem",
                    textAlign: "right",
                    fontFamily: "monospace",
                  }}
                >
                  {row.latency_ms !== null ? `${row.latency_ms}ms` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function Badge({ pass }: { pass: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "0.15rem 0.5rem",
        borderRadius: 999,
        fontSize: "0.75rem",
        fontWeight: 700,
        background: pass ? "#d4edda" : "#f8d7da",
        color: pass ? "#155724" : "#721c24",
      }}
    >
      {pass ? "PASS" : "FAIL"}
    </span>
  )
}
