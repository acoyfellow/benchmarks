import React, { useEffect, useState, useCallback, useRef } from "react"

/* ── Types ─────────────────────────────────────────────── */

interface Model {
  id: string
  name: string
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
  args_score: number
  latency_ms: number | null
  error: string | null
}

interface RunSummary {
  total: number
  tool_correct: number
  args_correct: number
  avg_args_score: number
  errors: number
  avg_latency_ms: number
}

interface RunResults {
  run_id: string
  status: string
  summary: RunSummary
  results: ResultRow[]
}

interface HistoryRun {
  id: string
  benchmark_id: string
  model_id: string
  status: string
  started_at: number | null
  completed_at: number | null
  created_at: number
}

interface LeaderboardEntry {
  model_id: string
  total_runs: number
  total_prompts: number
  avg_tool_pct: number
  avg_args_score: number
  consistency: number
  consistent_runs: number
  p50_latency_ms: number
  p95_latency_ms: number
  min_latency_ms: number
  max_latency_ms: number
}

interface BatchStatus {
  batch_id: string
  model_id: string
  benchmark_id: string
  total: number
  complete: number
  failed: number
  running: number
  pending: number
}

type SidebarView = "leaderboard" | "recent"

interface ModelRunScore {
  run_id: string
  tool_pct: number
  args_score: number
  avg_latency: number
  created_at: number
}

interface ModelStats {
  model_id: string
  runs: ModelRunScore[]
  latencies: number[]
}

/* ── Colors / tokens ───────────────────────────────────── */

const C = {
  bg: "#0a0a0f",
  surface: "#12121a",
  surfaceHover: "#1a1a25",
  border: "#1e1e2e",
  borderFocus: "#3b82f6",
  text: "#e4e4eb",
  textMuted: "#6b6b80",
  textDim: "#44445a",
  accent: "#3b82f6",
  accentHover: "#2563eb",
  green: "#22c55e",
  greenBg: "rgba(34,197,94,0.1)",
  red: "#ef4444",
  redBg: "rgba(239,68,68,0.1)",
  yellow: "#eab308",
  yellowBg: "rgba(234,179,8,0.1)",
  mono: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
  sans: "'Inter', system-ui, -apple-system, sans-serif",
}

/* ── Helpers ────────────────────────────────────────────── */

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    complete: { bg: C.greenBg, color: C.green },
    failed: { bg: C.redBg, color: C.red },
    running: { bg: C.yellowBg, color: C.yellow },
    pending: { bg: C.yellowBg, color: C.yellow },
  }
  const s = map[status] ?? { bg: C.surface, color: C.textMuted }
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 10px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.04em",
        background: s.bg,
        color: s.color,
        textTransform: "uppercase",
      }}
    >
      {(status === "running" || status === "pending") && (
        <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: s.color, animation: "pulse 1.5s infinite" }} />
      )}
      {status}
    </span>
  )
}

function Badge({ pass }: { pass: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.04em",
        background: pass ? C.greenBg : C.redBg,
        color: pass ? C.green : C.red,
      }}
    >
      {pass ? "PASS" : "FAIL"}
    </span>
  )
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: C.mono, color: C.text, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function formatTime(epoch: number) {
  const d = new Date(epoch * 1000)
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
}

function fmtMs(ms: number) {
  return ms > 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]
}

function shortModel(id: string) {
  // @cf/meta/llama-3-8b-instruct -> llama-3-8b-instruct
  const parts = id.split("/")
  return parts[parts.length - 1] ?? id
}

/* ── Main Component ────────────────────────────────────── */

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
  const [history, setHistory] = useState<HistoryRun[]>([])
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([])
  const [sidebarView, setSidebarView] = useState<SidebarView>("leaderboard")
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [modelStats, setModelStats] = useState<ModelStats | null>(null)
  const [selectedLeaderboardEntry, setSelectedLeaderboardEntry] = useState<LeaderboardEntry | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load models + benchmarks + history
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
        const d = (await r.json()) as { benchmarks?: Benchmark[]; error?: string }
        if (d.error) throw new Error(d.error)
        setBenchmarks(d.benchmarks ?? [])
      })
      .catch((e) => setFetchError(`Failed to load benchmarks: ${String(e)}`))

    loadHistory()
    loadLeaderboard()
  }, [])

  function loadModelStats(entry: LeaderboardEntry) {
    setSelectedLeaderboardEntry(entry)
    setModelStats(null)
    setRunResults(null)
    setRunId(null)
    setStatus(null)
    setBatchId(null)
    setBatchStatus(null)
    fetch(`/api/models/${encodeURIComponent(entry.model_id)}/stats`)
      .then(async (r) => {
        if (!r.ok) return
        const d = (await r.json()) as ModelStats
        setModelStats(d)
      })
      .catch(() => { /* ignore */ })
  }

  function loadLeaderboard() {
    fetch("/api/leaderboard")
      .then(async (r) => {
        if (!r.ok) return
        const d = (await r.json()) as { leaderboard?: LeaderboardEntry[] }
        setLeaderboard(d.leaderboard ?? [])
      })
      .catch(() => { /* ignore */ })
  }

  function loadHistory() {
    fetch("/api/runs?limit=20")
      .then(async (r) => {
        if (!r.ok) return
        const d = (await r.json()) as { runs?: HistoryRun[] }
        setHistory(d.runs ?? [])
      })
      .catch(() => { /* ignore */ })
  }

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
            loadHistory()
            loadLeaderboard()
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

  const startBatchPolling = useCallback(
    (bid: string) => {
      stopPolling()
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/runs/batch/${bid}`)
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          const data = (await r.json()) as BatchStatus
          setBatchStatus(data)
          setStatus(`${data.complete}/${data.total} runs complete`)
          if (data.pending === 0 && data.running === 0) {
            stopPolling()
            setLoading(false)
            setStatus(`Batch done: ${data.complete}/${data.total} complete${data.failed > 0 ? `, ${data.failed} failed` : ""}`)
            loadHistory()
            loadLeaderboard()
          }
        } catch (e) {
          setFetchError(`Polling error: ${String(e)}`)
          stopPolling()
          setLoading(false)
        }
      }, 2000)
    },
    [stopPolling]
  )

  const handleRun = useCallback(async () => {
    if (!selectedModel || !selectedBenchmark) return
    setLoading(true)
    setRunResults(null)
    setRunId(null)
    setBatchId(null)
    setBatchStatus(null)
    setStatus("Starting 5 runs…")
    setFetchError(null)
    stopPolling()

    try {
      const r = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          benchmark_id: selectedBenchmark,
          model_id: selectedModel,
          runs: 5,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as { batch_id: string; run_ids: string[]; total: number }
      setBatchId(data.batch_id)
      setStatus(`0/${data.total} runs complete`)
      startBatchPolling(data.batch_id)
    } catch (e) {
      setFetchError(`Failed to start batch: ${String(e)}`)
      setLoading(false)
      setStatus(null)
    }
  }, [selectedModel, selectedBenchmark, startBatchPolling, stopPolling])

  const loadRun = useCallback(async (rid: string) => {
    setRunId(rid)
    setLoading(true)
    setFetchError(null)
    try {
      const r = await fetch(`/api/runs/${rid}/results`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as RunResults
      setRunResults(data)
      setStatus(data.status)
      if (data.status === "running" || data.status === "pending") {
        startPolling(rid)
      } else {
        setLoading(false)
      }
    } catch (e) {
      setFetchError(`Failed to load run: ${String(e)}`)
      setLoading(false)
    }
  }, [startPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const accuracy =
    runResults && runResults.summary.total > 0
      ? Math.round(
          (runResults.summary.tool_correct / runResults.summary.total) * 100
        )
      : 0

  const argsAccuracy = runResults ? runResults.summary.avg_args_score : 0

  return (
    <>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        html, body, #root { height: 100%; }
        body { background: ${C.bg}; color: ${C.text}; font-family: ${C.sans}; }
        select, button { font-family: inherit; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* ── Sidebar ─────────────────────────── */}
        <aside
          style={{
            width: 280,
            flexShrink: 0,
            background: C.surface,
            borderRight: `1px solid ${C.border}`,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>⚡</span>
              <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em" }}>benchmarks</span>
            </div>
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 4 }}>Workers AI · Tool Calling</div>
          </div>

          {/* Sidebar tabs */}
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
            {(["leaderboard", "recent"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSidebarView(tab)}
                style={{
                  flex: 1,
                  padding: "10px 0",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                  background: "transparent",
                  border: "none",
                  borderBottom: sidebarView === tab ? `2px solid ${C.accent}` : "2px solid transparent",
                  color: sidebarView === tab ? C.text : C.textMuted,
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tab === "leaderboard" ? "\u{1F3C6} Ranking" : "\u{1F552} Recent"}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: "auto", padding: "4px 8px" }}>
            {/* Leaderboard view */}
            {sidebarView === "leaderboard" && (
              <>
                {leaderboard.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12, color: C.textDim, textAlign: "center" }}>No data yet</div>
                )}
                {leaderboard.map((entry, rank) => (
                  <button
                    key={entry.model_id}
                    onClick={() => loadModelStats(entry)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      marginBottom: 2,
                      background: "transparent",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      color: C.text,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = C.surfaceHover}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{
                        display: "inline-flex", alignItems: "center", justifyContent: "center",
                        width: 22, height: 22, borderRadius: 4, fontSize: rank < 3 ? 14 : 11, fontWeight: 700,
                        background: rank === 0 ? "rgba(234,179,8,0.15)" : rank === 1 ? "rgba(156,163,175,0.15)" : rank === 2 ? "rgba(180,83,9,0.15)" : C.border,
                        color: rank === 0 ? "#eab308" : rank === 1 ? "#9ca3af" : rank === 2 ? "#b45309" : C.textMuted,
                      }}>
                        {rank < 3 ? ["\u{1F947}", "\u{1F948}", "\u{1F949}"][rank] : rank + 1}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: C.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {shortModel(entry.model_id)}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 8, paddingLeft: 30, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 11 }}>
                        <span style={{ color: entry.avg_tool_pct >= 80 ? C.green : entry.avg_tool_pct >= 50 ? C.yellow : C.red, fontWeight: 700, fontFamily: C.mono }}>
                          {entry.avg_tool_pct}%
                        </span>
                        <span style={{ color: C.textDim, marginLeft: 2 }}>tool</span>
                      </div>
                      <div style={{ fontSize: 11 }}>
                        <span style={{ color: entry.avg_args_score >= 80 ? C.green : entry.avg_args_score >= 50 ? C.yellow : C.red, fontWeight: 700, fontFamily: C.mono }}>
                          {entry.avg_args_score}%
                        </span>
                        <span style={{ color: C.textDim, marginLeft: 2 }}>args</span>
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: 8, paddingLeft: 30, marginTop: 2, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 10 }}>
                        <span style={{ color: C.textMuted, fontFamily: C.mono }}>
                          p50: {entry.p50_latency_ms > 1000 ? `${(entry.p50_latency_ms / 1000).toFixed(1)}s` : `${entry.p50_latency_ms}ms`}
                        </span>
                      </div>
                      <div style={{ fontSize: 10 }}>
                        <span style={{ color: entry.p95_latency_ms > 2000 ? C.yellow : C.textMuted, fontFamily: C.mono }}>
                          p95: {entry.p95_latency_ms > 1000 ? `${(entry.p95_latency_ms / 1000).toFixed(1)}s` : `${entry.p95_latency_ms}ms`}
                        </span>
                      </div>
                    </div>
                    <div style={{ paddingLeft: 30, marginTop: 2, fontSize: 10, color: C.textDim }}>
                      {entry.consistent_runs}/{entry.total_runs} perfect · {entry.total_prompts} samples
                    </div>
                  </button>
                ))}
              </>
            )}

            {/* Recent runs view */}
            {sidebarView === "recent" && (
              <>
                {history.length === 0 && (
                  <div style={{ padding: 16, fontSize: 12, color: C.textDim, textAlign: "center" }}>No runs yet</div>
                )}
                {history.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => loadRun(h.id)}
                    style={{
                      display: "block",
                      width: "100%",
                      textAlign: "left",
                      padding: "10px 12px",
                      marginBottom: 2,
                      background: runId === h.id ? C.surfaceHover : "transparent",
                      border: "none",
                      borderRadius: 6,
                      cursor: "pointer",
                      color: C.text,
                      transition: "background 0.15s",
                    }}
                    onMouseEnter={(e) => { if (runId !== h.id) e.currentTarget.style.background = C.surfaceHover }}
                    onMouseLeave={(e) => { if (runId !== h.id) e.currentTarget.style.background = "transparent" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, fontFamily: C.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 160 }}>
                        {shortModel(h.model_id)}
                      </span>
                      <StatusPill status={h.status} />
                    </div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>
                      {h.created_at ? formatTime(h.created_at) : "—"}
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        </aside>

        {/* ── Main content ───────────────────── */}
        <main style={{ flex: 1, overflow: "auto", padding: "32px 40px" }}>
          {/* Controls */}
          <div
            style={{
              display: "flex",
              gap: 12,
              alignItems: "flex-end",
              marginBottom: 32,
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: "1 1 240px", minWidth: 200 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Model
              </label>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontSize: 13,
                  outline: "none",
                  appearance: "auto" as React.CSSProperties["appearance"],
                }}
              >
                <option value="">Select a model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ flex: "0 1 200px", minWidth: 160 }}>
              <label style={{ display: "block", marginBottom: 6, fontSize: 12, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Benchmark
              </label>
              <select
                value={selectedBenchmark}
                onChange={(e) => setSelectedBenchmark(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: `1px solid ${C.border}`,
                  background: C.surface,
                  color: C.text,
                  fontSize: 13,
                  outline: "none",
                  appearance: "auto" as React.CSSProperties["appearance"],
                }}
              >
                <option value="">Select…</option>
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
                padding: "10px 24px",
                background: loading || !selectedModel || !selectedBenchmark ? C.border : C.accent,
                color: loading || !selectedModel || !selectedBenchmark ? C.textDim : "#fff",
                border: "none",
                borderRadius: 8,
                cursor: loading || !selectedModel || !selectedBenchmark ? "not-allowed" : "pointer",
                fontWeight: 600,
                fontSize: 13,
                transition: "all 0.15s",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => {
                if (!loading && selectedModel && selectedBenchmark)
                  e.currentTarget.style.background = C.accentHover
              }}
              onMouseLeave={(e) => {
                if (!loading && selectedModel && selectedBenchmark)
                  e.currentTarget.style.background = C.accent
              }}
            >
              {loading ? "Running…" : "Run Benchmark"}
            </button>
          </div>

          {/* Error */}
          {fetchError && (
            <div
              style={{
                marginBottom: 24,
                padding: "12px 16px",
                background: C.redBg,
                border: `1px solid rgba(239,68,68,0.2)`,
                color: C.red,
                borderRadius: 8,
                fontSize: 13,
              }}
            >
              {fetchError}
            </div>
          )}

          {/* Status bar */}
          {status && (
            <div style={{ marginBottom: 24, display: "flex", alignItems: "center", gap: 12 }}>
              {batchStatus ? (
                <>
                  <StatusPill status={batchStatus.pending === 0 && batchStatus.running === 0 ? "complete" : "running"} />
                  <span style={{ fontSize: 13, color: C.text }}>{status}</span>
                  {batchId && (
                    <span style={{ fontSize: 11, color: C.textDim, fontFamily: C.mono }}>
                      {batchId.slice(0, 8)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <StatusPill status={status} />
                  {runId && (
                    <span style={{ fontSize: 11, color: C.textDim, fontFamily: C.mono }}>
                      {runId}
                    </span>
                  )}
                </>
              )}
            </div>
          )}

          {/* Batch progress bar */}
          {batchStatus && (batchStatus.running > 0 || batchStatus.pending > 0) && (
            <div style={{ marginBottom: 24, background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: C.textMuted }}>Batch Progress</span>
                <span style={{ fontSize: 12, fontFamily: C.mono, color: C.text }}>
                  {batchStatus.complete}/{batchStatus.total}
                </span>
              </div>
              <div style={{ background: C.border, borderRadius: 4, height: 8, overflow: "hidden" }}>
                <div style={{
                  height: 8, borderRadius: 4,
                  width: `${(batchStatus.complete / batchStatus.total) * 100}%`,
                  background: C.accent,
                  transition: "width 0.5s ease",
                }} />
              </div>
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 11, color: C.textMuted }}>
                <span>{shortModel(batchStatus.model_id)}</span>
                {batchStatus.running > 0 && <span style={{ color: C.yellow }}>{batchStatus.running} running</span>}
                {batchStatus.failed > 0 && <span style={{ color: C.red }}>{batchStatus.failed} failed</span>}
              </div>
            </div>
          )}

          {/* Error banner when all results are errors */}
          {runResults && runResults.summary.errors === runResults.summary.total && runResults.summary.total > 0 && (
            <div
              style={{
                marginBottom: 24,
                padding: "20px 24px",
                background: C.redBg,
                border: `1px solid rgba(239,68,68,0.2)`,
                borderRadius: 12,
              }}
            >
              <div style={{ fontSize: 15, fontWeight: 600, color: C.red, marginBottom: 6 }}>
                ⚠ Model does not support tool calling
              </div>
              <div style={{ fontSize: 13, color: C.textMuted, lineHeight: 1.5 }}>
                All {runResults.summary.total} prompts returned errors. This model likely doesn’t accept the <code style={{ fontFamily: C.mono, fontSize: 12, background: C.surface, padding: "2px 6px", borderRadius: 4 }}>tools</code> parameter.
              </div>
            </div>
          )}

          {/* Summary cards */}
          {runResults && runResults.summary.total > 0 && runResults.summary.errors < runResults.summary.total && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                gap: 16,
                marginBottom: 32,
              }}
            >
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                <Stat label="Tool Accuracy" value={`${accuracy}%`} />
                <div style={{ marginTop: 12, background: C.border, borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 4,
                      width: `${accuracy}%`,
                      background: accuracy >= 80 ? C.green : accuracy >= 50 ? C.yellow : C.red,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>

              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                <Stat label="Args Accuracy" value={`${argsAccuracy}%`} />
                <div style={{ marginTop: 12, background: C.border, borderRadius: 4, height: 6, overflow: "hidden" }}>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 4,
                      width: `${argsAccuracy}%`,
                      background: argsAccuracy >= 80 ? C.green : argsAccuracy >= 50 ? C.yellow : C.red,
                      transition: "width 0.5s ease",
                    }}
                  />
                </div>
              </div>

              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                <Stat
                  label="Tool Correct"
                  value={`${runResults.summary.tool_correct}/${runResults.summary.total}`}
                  sub={`args perfect: ${runResults.summary.args_correct}/${runResults.summary.total}`}
                />
              </div>

              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                <Stat
                  label="Avg Latency"
                  value={runResults.summary.avg_latency_ms > 1000
                    ? `${(runResults.summary.avg_latency_ms / 1000).toFixed(1)}s`
                    : `${runResults.summary.avg_latency_ms}ms`
                  }
                />
              </div>
            </div>
          )}

          {/* Results table */}
          {runResults && runResults.results.length > 0 && runResults.summary.errors < runResults.summary.total && (
            <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr>
                    {[
                      ["#", "left", 40],
                      ["Prompt", "left", undefined],
                      ["Expected", "left", 120],
                      ["Called", "left", 120],
                      ["Tool", "center", 70],
                      ["Args", "center", 70],
                      ["Latency", "right", 90],
                    ].map(([label, align, w]) => (
                      <th
                        key={label as string}
                        style={{
                          padding: "12px 16px",
                          textAlign: align as React.CSSProperties["textAlign"],
                          fontSize: 11,
                          fontWeight: 600,
                          color: C.textMuted,
                          textTransform: "uppercase",
                          letterSpacing: "0.06em",
                          borderBottom: `1px solid ${C.border}`,
                          width: w ? `${w as number}px` : undefined,
                        }}
                      >
                        {label as string}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {runResults.results.map((row, i) => (
                    <tr
                      key={row.prompt_index}
                      style={{
                        borderBottom: i < runResults.results.length - 1 ? `1px solid ${C.border}` : "none",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => e.currentTarget.style.background = C.surfaceHover}
                      onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                    >
                      <td style={{ padding: "12px 16px", color: C.textDim, fontFamily: C.mono, fontSize: 12 }}>
                        {row.prompt_index + 1}
                      </td>
                      <td
                        style={{
                          padding: "12px 16px",
                          maxWidth: 300,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                        title={row.prompt}
                      >
                        {row.prompt}
                      </td>
                      <td style={{ padding: "12px 16px", fontFamily: C.mono, fontSize: 12, color: C.textMuted }}>
                        {row.expected_tool}
                      </td>
                      <td style={{ padding: "12px 16px", fontFamily: C.mono, fontSize: 12, color: row.tool_correct ? C.green : C.red }}>
                        {row.tool_called ?? "—"}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        <Badge pass={row.tool_correct} />
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "center" }}>
                        {row.args_correct ? (
                          <Badge pass={true} />
                        ) : row.tool_correct ? (
                          <span style={{
                            display: "inline-block",
                            padding: "2px 8px",
                            borderRadius: 4,
                            fontSize: 11,
                            fontWeight: 700,
                            fontFamily: C.mono,
                            background: row.args_score >= 0.5 ? C.yellowBg : C.redBg,
                            color: row.args_score >= 0.5 ? C.yellow : C.red,
                          }}>
                            {Math.round(row.args_score * 100)}%
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: C.textDim }}>—</span>
                        )}
                      </td>
                      <td style={{ padding: "12px 16px", textAlign: "right", fontFamily: C.mono, fontSize: 12, color: C.textMuted }}>
                        {row.latency_ms !== null ? `${row.latency_ms}ms` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Model detail view */}
          {selectedLeaderboardEntry && !runResults && !status && (
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4, fontFamily: C.mono }}>
                {shortModel(selectedLeaderboardEntry.model_id)}
              </h2>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 24 }}>
                {selectedLeaderboardEntry.model_id}
              </div>

              {/* Stats grid */}
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                gap: 16,
                marginBottom: 32,
              }}>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                  <Stat label="Tool Accuracy" value={`${selectedLeaderboardEntry.avg_tool_pct}%`} />
                </div>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                  <Stat label="Args Accuracy" value={`${selectedLeaderboardEntry.avg_args_score}%`} />
                </div>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                  <Stat label="Consistency" value={`${selectedLeaderboardEntry.consistent_runs}/${selectedLeaderboardEntry.total_runs}`}
                    sub={`${selectedLeaderboardEntry.consistency}% perfect runs`} />
                </div>
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px 24px" }}>
                  <Stat label="Samples" value={selectedLeaderboardEntry.total_prompts}
                    sub={`${selectedLeaderboardEntry.total_runs} runs × 20 prompts`} />
                </div>
              </div>

              {/* Latency breakdown */}
              <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, padding: "24px", marginBottom: 24 }}>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 16 }}>Latency Distribution</div>
                <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                  {[
                    ["Min", selectedLeaderboardEntry.min_latency_ms],
                    ["p50", selectedLeaderboardEntry.p50_latency_ms],
                    ["p95", selectedLeaderboardEntry.p95_latency_ms],
                    ["Max", selectedLeaderboardEntry.max_latency_ms],
                  ].map(([label, val]) => (
                    <div key={label as string}>
                      <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label as string}</div>
                      <div style={{ fontSize: 22, fontWeight: 700, fontFamily: C.mono, color: (val as number) > 3000 ? C.red : (val as number) > 1500 ? C.yellow : C.green }}>
                        {fmtMs(val as number)}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Visual latency bar */}
                {modelStats && modelStats.latencies.length > 0 && (() => {
                  const lats = [...modelStats.latencies].sort((a, b) => a - b)
                  const maxLat = lats[lats.length - 1]
                  const p50 = computePercentile(lats, 50)
                  const p95 = computePercentile(lats, 95)
                  return (
                    <div style={{ marginTop: 16 }}>
                      <div style={{ position: "relative", height: 24, background: C.border, borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(p50 / maxLat) * 100}%`, background: C.green, opacity: 0.3, borderRadius: 4 }} />
                        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(p95 / maxLat) * 100}%`, background: C.yellow, opacity: 0.2, borderRadius: 4 }} />
                        <div style={{ position: "absolute", left: `${(p50 / maxLat) * 100}%`, top: 0, height: "100%", width: 2, background: C.green }} />
                        <div style={{ position: "absolute", left: `${(p95 / maxLat) * 100}%`, top: 0, height: "100%", width: 2, background: C.yellow }} />
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: C.textDim }}>
                        <span>0ms</span>
                        <span>{fmtMs(maxLat)}</span>
                      </div>
                    </div>
                  )
                })()}
              </div>

              {/* Per-run breakdown */}
              {modelStats && modelStats.runs.length > 0 && (
                <div style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden" }}>
                  <div style={{ padding: "16px 24px", borderBottom: `1px solid ${C.border}`, fontSize: 13, fontWeight: 600 }}>Run History</div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        {["#", "Tool %", "Args %", "Avg Latency", "When"].map((h) => (
                          <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${C.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {modelStats.runs.map((run, i) => (
                        <tr key={run.run_id}
                          style={{ borderBottom: i < modelStats.runs.length - 1 ? `1px solid ${C.border}` : "none" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = C.surfaceHover}
                          onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                        >
                          <td style={{ padding: "10px 16px", color: C.textDim, fontFamily: C.mono, fontSize: 12 }}>{i + 1}</td>
                          <td style={{ padding: "10px 16px", fontFamily: C.mono }}>
                            <span style={{ color: run.tool_pct === 100 ? C.green : run.tool_pct >= 80 ? C.yellow : C.red, fontWeight: 700 }}>{run.tool_pct}%</span>
                          </td>
                          <td style={{ padding: "10px 16px", fontFamily: C.mono }}>
                            <span style={{ color: run.args_score === 100 ? C.green : run.args_score >= 80 ? C.yellow : C.red, fontWeight: 700 }}>{run.args_score}%</span>
                          </td>
                          <td style={{ padding: "10px 16px", fontFamily: C.mono, color: C.textMuted }}>{fmtMs(run.avg_latency)}</td>
                          <td style={{ padding: "10px 16px", color: C.textMuted, fontSize: 12 }}>{formatTime(run.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Empty state */}
          {!runResults && !status && !selectedLeaderboardEntry && (
            <div style={{ textAlign: "center", padding: "80px 20px" }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>⚡</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Workers AI Benchmarks</div>
              <div style={{ fontSize: 14, color: C.textMuted, maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
                Select a model and benchmark above to test tool-calling reliability and latency across Workers AI models.
              </div>
            </div>
          )}
        </main>
      </div>
    </>
  )
}
