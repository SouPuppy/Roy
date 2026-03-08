import { useEffect, useState } from "react";
import { AreaChart, Area, LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Legend, CartesianGrid } from "recharts";

type MemoryKind = "identity" | "task" | "knowledge" | "reference" | "note" | "unclassified";
type MemoryScope = "session" | "project" | "global";

type MemoryItem = {
  id: string;
  kind: MemoryKind;
  scope: MemoryScope;
  content: string;
};

type KindCounts = Partial<Record<MemoryKind, number>>;

const ALL_KINDS: MemoryKind[] = ["identity", "task", "knowledge", "reference", "note", "unclassified"];
const ALL_SCOPES: MemoryScope[] = ["global", "project", "session"];

const KIND_COLORS: Record<MemoryKind, string> = {
  identity: "bg-violet-100 text-violet-700 border-violet-200",
  task: "bg-amber-100 text-amber-700 border-amber-200",
  knowledge: "bg-emerald-100 text-emerald-700 border-emerald-200",
  reference: "bg-sky-100 text-sky-700 border-sky-200",
  note: "bg-slate-100 text-slate-600 border-slate-200",
  unclassified: "bg-slate-100 text-slate-500 border-slate-200",
};

const CHART_COLORS: Record<MemoryKind, string> = {
  identity: "#7c3aed",
  task: "#d97706",
  knowledge: "#059669",
  reference: "#0284c7",
  note: "#57534e",
  unclassified: "#78716c",
};

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const data = (await r.json().catch(() => ({}))) as { error?: string };
  if (!r.ok) throw new Error(data.error ?? `http_${r.status}`);
  return data as T;
}

function KindStats({ counts }: { counts: KindCounts }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ALL_KINDS.map((k) => {
        const n = counts[k] ?? 0;
        const color = KIND_COLORS[k];
        return (
          <span key={k} className={`badge border ${color}`}>
            {k}: {n}
          </span>
        );
      })}
    </div>
  );
}

function KindBadge({ kind, scope }: { kind: MemoryKind; scope: MemoryScope }) {
  const color = KIND_COLORS[kind];
  return (
    <span className={`badge border ${color}`}>
      {kind} / {scope}
    </span>
  );
}

export default function App() {
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [counts, setCounts] = useState<KindCounts>({});
  const [rememberKind, setRememberKind] = useState<MemoryKind | "auto">("auto");
  const [rememberScope, setRememberScope] = useState<MemoryScope>("global");
  const [rememberContent, setRememberContent] = useState("");
  const [rememberMsg, setRememberMsg] = useState("");
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("");
  const [kind, setKind] = useState("");
  const [limit, setLimit] = useState(20);
  const [offset, setOffset] = useState(0);
  const [recallQuery, setRecallQuery] = useState("");
  const [recallLimit, setRecallLimit] = useState(8);
  const [recallBox, setRecallBox] = useState("[]");
  const [askQuestion, setAskQuestion] = useState("");
  const [askBox, setAskBox] = useState("");
  const [askLoading, setAskLoading] = useState(false);
  const [tab, setTab] = useState<"overview" | "chat" | "memory">("overview");

  type StatusData = {
    llm?: { provider?: string; ok?: boolean; message?: string; latency_ms?: number };
    embedding?: { model?: string; status?: string };
    rag?: { storage?: { path?: string; ann?: { enabled?: boolean; message?: string }; corpusSize?: number } };
  };

  const [statusData, setStatusData] = useState<StatusData | null>(null);
  const [statusJson, setStatusJson] = useState("loading...");
  const [showStatusJson, setShowStatusJson] = useState(false);

  async function loadStatus() {
    const data = await j<StatusData>("/api/status");
    setStatusData(data);
    setStatusJson(JSON.stringify(data, null, 2));
  }

  async function loadMemories() {
    const p = new URLSearchParams();
    if (query.trim()) p.set("query", query.trim());
    if (scope) p.set("scope", scope);
    if (kind) p.set("kind", kind);
    p.set("limit", String(limit || 20));
    p.set("offset", String(offset || 0));

    const data = await j<{ items?: MemoryItem[]; counts?: KindCounts }>(`/api/memories?${p.toString()}`);
    setMemories(data.items ?? []);
    setCounts(data.counts ?? {});
  }

  async function onRemember() {
    const content = rememberContent.trim();
    if (!content) {
      window.alert("内容不能为空");
      return;
    }
    const data = await j<{ id: string; kind: string; scope: string }>("/api/remember", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content,
        kind: rememberKind,
        scope: rememberScope,
      }),
    });
    setRememberMsg(`已保存: ${data.id} (${data.kind}/${data.scope})`);
    setRememberContent("");
    await Promise.all([loadMemories(), loadMemoryStats(), loadMemoryStatsByKind()]);
    setTimeout(() => setRememberMsg(""), 4000);
  }

  async function onDelete(id: string) {
    if (!window.confirm("确认删除这条 memory?")) return;
    await j<{ ok: boolean }>(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" });
    await loadMemories();
  }

  async function onRecall() {
    const q = recallQuery.trim();
    if (!q) {
      window.alert("query 不能为空");
      return;
    }
    const data = await j<{ items: unknown[] }>("/api/recall", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: q, limit: recallLimit }),
    });
    setRecallBox(JSON.stringify(data.items, null, 2));
  }

  async function onAsk() {
    const q = askQuestion.trim();
    if (!q) {
      window.alert("问题不能为空");
      return;
    }
    setAskLoading(true);
    setAskBox("thinking...");
    try {
      const data = await j<{ answer?: string }>("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      setAskBox(data.answer ?? "");
    } finally {
      setAskLoading(false);
    }
  }

  type MemoryStatsItem = { date: string; label: string; count: number };
  type MemoryStatsByKindItem = MemoryStatsItem & Record<MemoryKind, number>;
  const [memoryStats, setMemoryStats] = useState<MemoryStatsItem[]>([]);
  const [memoryStatsByKind, setMemoryStatsByKind] = useState<MemoryStatsByKindItem[]>([]);

  async function loadMemoryStats() {
    const data = await j<{ items?: MemoryStatsItem[] }>("/api/memory-stats?days=7");
    setMemoryStats(data.items ?? []);
  }

  async function loadMemoryStatsByKind() {
    const data = await j<{ items?: MemoryStatsByKindItem[] }>("/api/memory-stats-by-kind?days=7");
    setMemoryStatsByKind(data.items ?? []);
  }

  useEffect(() => {
    void loadStatus().catch((e) => {
      setStatusJson(String(e));
      setStatusData(null);
    });
    void loadMemories().catch(() => {});
    void loadMemoryStats().catch(() => {});
    void loadMemoryStatsByKind().catch(() => {});
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header + Menu */}
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-[1800px] items-center justify-between px-10 py-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">Roy</h1>
            <p className="text-sm text-slate-500">Memory · Recall · Ask</p>
          </div>
          <nav className="flex gap-2">
            {(["overview", "chat", "memory"] as const).map((t) => (
              <button
                key={t}
                className={`rounded-lg px-4 py-2 text-sm font-medium uppercase tracking-wider transition ${
                  tab === t
                    ? "bg-sky-500 text-white"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                }`}
                onClick={() => setTab(t)}
              >
                {t === "overview" ? "Overview" : t === "chat" ? "Chat" : "Memory"}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] px-10 py-10">
        {tab === "overview" && (
          <div className="space-y-8">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">系统状态</h2>
                <div className="flex items-center gap-1">
                    <button
                    className="rounded p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                    title="切换 JSON 视图"
                    onClick={() => setShowStatusJson((v) => !v)}
                  >
                    <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </button>
                  <button
                    className="btn-ghost text-xs"
                    onClick={() => void loadStatus().catch((e) => window.alert(e.message))}
                  >
                    刷新
                  </button>
                </div>
              </div>
              <div className="p-3">
                {showStatusJson ? (
                  <pre className="panel-pre">{statusJson}</pre>
                ) : statusData ? (
                  <table className="status-table w-full text-xs">
                    <tbody>
                      <tr>
                        <td className="w-20 py-2 pr-4 text-right text-slate-500">LLM</td>
                        <td className="py-2 text-slate-700">
                          <span className={statusData.llm?.ok ? "text-emerald-600" : "text-amber-600"}>{statusData.llm?.ok ? "✓" : "✗"}</span>{" "}
                          {statusData.llm?.provider ?? "—"}
                          {statusData.llm?.message && ` · ${statusData.llm.message}`}
                          {statusData.llm?.latency_ms != null && ` · ${statusData.llm.latency_ms}ms`}
                        </td>
                      </tr>
                      <tr>
                        <td className="w-20 py-2 pr-4 text-right text-slate-500">Embedding</td>
                        <td className="py-2 text-slate-700">
                          <span className={
                            statusData.embedding?.status === "ready" ? "text-emerald-600" :
                            statusData.embedding?.status === "cached" ? "text-sky-600" : "text-slate-500"
                          }>{statusData.embedding?.status ?? "—"}</span>
                          {statusData.embedding?.model && ` · ${statusData.embedding.model}`}
                        </td>
                      </tr>
                      <tr>
                        <td className="w-20 py-2 pr-4 text-right text-slate-500">Memory</td>
                        <td className="py-2 text-slate-700">
                          {statusData.rag?.storage?.corpusSize ?? 0} 条
                          {statusData.rag?.storage?.ann?.enabled ? " · ANN ✓" : statusData.rag?.storage?.ann?.message ? ` · ${statusData.rag.storage.ann.message}` : ""}
                          {statusData.rag?.storage?.path && (
                            <div className="mt-1 truncate font-mono text-xs text-slate-500" title={statusData.rag.storage.path}>
                              {statusData.rag.storage.path}
                            </div>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  <pre className="panel-pre">{statusJson}</pre>
                )}
              </div>
            </section>

            <section className="rounded-xl bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-slate-800">近 7 天存入</h2>
                <div className="flex gap-2">
                  <button className="btn-ghost text-sm" onClick={() => void loadMemoryStats().catch(() => {})}>
                    刷新
                  </button>
                  <button className="btn-primary text-sm" onClick={() => setTab("memory")}>
                    管理 →
                  </button>
                </div>
              </div>
              {memoryStats.length > 0 ? (
                <div style={{ width: "100%", height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={memoryStats} margin={{ top: 16, right: 24, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 13, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                      <YAxis tick={{ fontSize: 13, fill: "#64748b" }} tickLine={false} axisLine={false} width={36} domain={[0, "auto"]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                        labelStyle={{ color: "#64748b" }}
                        formatter={(value: number) => [`${value} 条`, "存入"]}
                        labelFormatter={(label) => label}
                      />
                      <Line type="monotone" dataKey="count" stroke="#0ea5e9" strokeWidth={2} dot={{ fill: "#0ea5e9", r: 5 }} activeDot={{ r: 7 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[260px] items-center justify-center text-slate-500">加载中…</div>
              )}
            </section>
          </div>
        )}

        {tab === "chat" && (
          <section className="card">
            <div className="card-header">
              <h2 className="card-title">Ask</h2>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex flex-wrap items-center gap-3">
                <input
                  className="input min-w-[180px] flex-1"
                  placeholder="输入问题"
                  value={askQuestion}
                  onChange={(e) => setAskQuestion(e.target.value)}
                />
                <button
                  className="btn-primary"
                  disabled={askLoading}
                  onClick={() => void onAsk().catch((e) => window.alert(e.message))}
                >
                  {askLoading ? "..." : "提问"}
                </button>
              </div>
              <pre className="panel-pre min-h-[360px] text-sm">{askBox}</pre>
            </div>
          </section>
        )}

        {tab === "memory" && (
          <div className="space-y-8">
            <section className="-mx-10 w-[calc(100%+5rem)]">
              <div className="mb-4 flex items-center justify-between px-10">
                <h2 className="text-lg font-semibold text-slate-800">近 7 天按类别</h2>
                <button className="btn-ghost text-sm" onClick={() => void loadMemoryStatsByKind().catch(() => {})}>
                  刷新
                </button>
              </div>
              {memoryStatsByKind.length > 0 ? (
                <div className="w-full" style={{ height: 280 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={memoryStatsByKind} margin={{ top: 16, right: 24, left: 24, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="label" tick={{ fontSize: 13, fill: "#64748b" }} tickLine={false} axisLine={{ stroke: "#cbd5e1" }} />
                      <YAxis tick={{ fontSize: 13, fill: "#64748b" }} tickLine={false} axisLine={false} width={36} domain={[0, "auto"]} />
                      <Tooltip
                        contentStyle={{ backgroundColor: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 13, boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)" }}
                        formatter={(value: number, name: string) => [value, name]}
                        labelFormatter={(label) => label}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v} />
                      {ALL_KINDS.map((k) => (
                        <Area key={k} type="monotone" dataKey={k} stackId="1" stroke={CHART_COLORS[k]} fill={CHART_COLORS[k]} fillOpacity={0.5} />
                      ))}
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-[280px] items-center justify-center text-slate-500">加载中…</div>
              )}
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className="card">
              <div className="card-header">
                <h2 className="card-title">写入 Memory</h2>
              </div>
              <div className="space-y-2.5 p-3">
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">kind</span>
                    <select
                      className="select min-w-[120px]"
                      value={rememberKind}
                      onChange={(e) => setRememberKind(e.target.value as MemoryKind | "auto")}
                    >
                      <option value="auto">auto</option>
                      {ALL_KINDS.map((k) => (
                        <option key={k} value={k}>{k}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-0.5">
                    <span className="text-[11px] font-medium text-slate-500">scope</span>
                    <select
                      className="select min-w-[100px]"
                      value={rememberScope}
                      onChange={(e) => setRememberScope(e.target.value as MemoryScope)}
                    >
                      {ALL_SCOPES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </label>
                </div>
                <textarea
                  className="input min-h-20 w-full resize-y"
                  placeholder="输入要记住的内容..."
                  value={rememberContent}
                  onChange={(e) => setRememberContent(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    className="btn-primary"
                    onClick={() => void onRemember().catch((e) => window.alert(e.message))}
                  >
                    保存
                  </button>
                  {rememberMsg && <span className="text-xs text-emerald-600">{rememberMsg}</span>}
                </div>
              </div>
            </section>

            <section className="card">
              <div className="card-header">
                <h2 className="card-title">Recall</h2>
              </div>
              <div className="space-y-2.5 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    className="input min-w-[180px] flex-1"
                    placeholder="query"
                    value={recallQuery}
                    onChange={(e) => setRecallQuery(e.target.value)}
                  />
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    max={20}
                    value={recallLimit}
                    onChange={(e) => setRecallLimit(Number(e.target.value || "8"))}
                  />
                  <button
                    className="btn-primary"
                    onClick={() => void onRecall().catch((e) => window.alert(e.message))}
                  >
                    召回
                  </button>
                </div>
                <pre className="panel-pre">{recallBox}</pre>
              </div>
            </section>

            <section className="card lg:col-span-2">
              <div className="card-header">
                <h2 className="card-title">Memory 列表</h2>
                <button className="btn-ghost text-xs" onClick={() => void loadMemories().catch(() => {})}>
                  刷新
                </button>
              </div>
              <div className="space-y-2.5 p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <input
                    className="input min-w-[180px]"
                    placeholder="query"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                  <select className="select min-w-[100px]" value={scope} onChange={(e) => setScope(e.target.value)}>
                    <option value="">all scopes</option>
                    {ALL_SCOPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                  <select className="select min-w-[120px]" value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="">all kinds</option>
                    {ALL_KINDS.map((k) => (
                      <option key={k} value={k}>{k}</option>
                    ))}
                  </select>
                  <input
                    className="input w-20"
                    type="number"
                    min={1}
                    max={100}
                    value={limit}
                    onChange={(e) => setLimit(Number(e.target.value || "20"))}
                  />
                  <input
                    className="input w-20"
                    type="number"
                    min={0}
                    value={offset}
                    onChange={(e) => setOffset(Number(e.target.value || "0"))}
                  />
                  <button
                    className="btn-primary"
                    onClick={() => void loadMemories().catch((e) => window.alert(e.message))}
                  >
                    查询
                  </button>
                </div>
                <KindStats counts={counts} />
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  {memories.length === 0 ? (
                    <div className="empty-state">暂无数据</div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {memories.map((item, idx) => (
                        <div
                          key={item.id}
                          className="group flex items-start gap-3 px-4 py-3 transition hover:bg-slate-50"
                        >
                          <span className="font-mono text-xs text-slate-500 tabular-nums">{idx + 1}</span>
                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex flex-wrap items-center gap-1.5">
                              <KindBadge kind={item.kind} scope={item.scope} />
                              <span className="font-mono text-xs text-slate-500">{item.id}</span>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{item.content}</p>
                          </div>
                          <button
                            className="btn-danger shrink-0 opacity-70 transition group-hover:opacity-100"
                            onClick={() => void onDelete(item.id).catch((e) => window.alert(e.message))}
                          >
                            删除
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </section>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
