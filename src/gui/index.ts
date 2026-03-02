import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { ask } from "@/provider/ask";
import {
  forget,
  getMemoryKindCounts,
  getRagStatus,
  listMemories,
  openMemory,
  recallScored,
  remember,
} from "@/rag";
import { getEmbeddingStatus } from "@/rag/embedding";
import { getLlmStatus } from "@/provider";
import type { MemoryKind, MemoryScope } from "@/rag/types";

type JsonObject = Record<string, unknown>;

function sendJson(res: ServerResponse, code: number, payload: JsonObject): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(html);
}

async function readBody(req: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return {};
  } catch {
    return {};
  }
}

function normalizeScope(v: unknown): MemoryScope | undefined {
  if (v === "session" || v === "project" || v === "global") return v;
  return undefined;
}

function normalizeKind(v: unknown): MemoryKind | undefined {
  if (v === "identity" || v === "task" || v === "knowledge" || v === "reference" || v === "note" || v === "unclassified") {
    return v;
  }
  return undefined;
}

function parseIntSafe(v: string | null, fallback: number): number {
  const n = Number(v ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function getHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Roy Memory GUI</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Inter, -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; background: #0b1020; color: #e5e7eb; }
    .wrap { max-width: 1120px; margin: 0 auto; padding: 20px; }
    h1 { margin: 0 0 4px; font-size: 26px; }
    .sub { margin: 0 0 18px; color: #94a3b8; }
    .grid { display: grid; gap: 14px; grid-template-columns: repeat(12, minmax(0, 1fr)); }
    .card { grid-column: span 12; background: rgba(17, 24, 39, .8); border: 1px solid #1f2937; border-radius: 12px; padding: 14px; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    label { font-size: 12px; color: #93c5fd; }
    input, select, textarea, button { border: 1px solid #334155; background: #0f172a; color: #f8fafc; border-radius: 8px; padding: 8px 10px; }
    textarea { width: 100%; min-height: 88px; resize: vertical; }
    button { cursor: pointer; background: #1d4ed8; border-color: #1d4ed8; }
    button.secondary { background: #1f2937; border-color: #374151; }
    .muted { color: #94a3b8; font-size: 12px; }
    .pill { display: inline-block; font-size: 12px; border: 1px solid #334155; border-radius: 999px; padding: 3px 8px; margin-right: 6px; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid #1f2937; text-align: left; padding: 8px; vertical-align: top; font-size: 13px; }
    code { color: #93c5fd; }
    pre { white-space: pre-wrap; word-break: break-word; background: #020617; border: 1px solid #1e293b; border-radius: 8px; padding: 10px; max-height: 240px; overflow: auto; }
    @media (min-width: 900px) {
      .half { grid-column: span 6; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Roy Memory GUI</h1>
    <p class="sub">管理 memory / recall / ask 的本地界面</p>

    <div class="grid">
      <section class="card half">
        <div class="row" style="justify-content: space-between;">
          <strong>系统状态</strong>
          <button id="btnStatus" class="secondary">刷新</button>
        </div>
        <pre id="statusBox">loading...</pre>
      </section>

      <section class="card half">
        <strong>写入 Memory</strong>
        <div class="row" style="margin-top: 8px;">
          <div>
            <label>kind</label><br />
            <select id="rememberKind">
              <option value="auto">auto</option>
              <option value="identity">identity</option>
              <option value="task">task</option>
              <option value="knowledge">knowledge</option>
              <option value="reference">reference</option>
              <option value="note">note</option>
              <option value="unclassified">unclassified</option>
            </select>
          </div>
          <div>
            <label>scope</label><br />
            <select id="rememberScope">
              <option value="global">global</option>
              <option value="project">project</option>
              <option value="session">session</option>
            </select>
          </div>
        </div>
        <textarea id="rememberContent" placeholder="输入要记住的内容..."></textarea>
        <div class="row">
          <button id="btnRemember">保存</button>
          <span id="rememberMsg" class="muted"></span>
        </div>
      </section>

      <section class="card">
        <strong>Memory 列表</strong>
        <div class="row" style="margin-top: 8px;">
          <input id="q" placeholder="query" style="min-width: 180px;" />
          <select id="scope">
            <option value="">all scopes</option>
            <option value="session">session</option>
            <option value="project">project</option>
            <option value="global">global</option>
          </select>
          <select id="kind">
            <option value="">all kinds</option>
            <option value="identity">identity</option>
            <option value="task">task</option>
            <option value="knowledge">knowledge</option>
            <option value="reference">reference</option>
            <option value="note">note</option>
            <option value="unclassified">unclassified</option>
          </select>
          <input id="limit" type="number" min="1" max="100" value="20" style="width: 90px;" />
          <input id="offset" type="number" min="0" value="0" style="width: 90px;" />
          <button id="btnSearch">查询</button>
        </div>
        <div id="kindStats" class="muted" style="margin: 8px 0;"></div>
        <table>
          <thead>
            <tr><th>#</th><th>kind/scope</th><th>content</th><th>操作</th></tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </section>

      <section class="card half">
        <strong>Recall</strong>
        <div class="row" style="margin-top: 8px;">
          <input id="recallQuery" placeholder="query" style="min-width: 220px;" />
          <input id="recallLimit" type="number" value="8" min="1" max="20" style="width: 90px;" />
          <button id="btnRecall">召回</button>
        </div>
        <pre id="recallBox">[]</pre>
      </section>

      <section class="card half">
        <strong>Ask</strong>
        <div class="row" style="margin-top: 8px;">
          <input id="askQuestion" placeholder="输入问题" style="min-width: 260px;" />
          <button id="btnAsk">提问</button>
        </div>
        <pre id="askBox"></pre>
      </section>
    </div>
  </div>

  <script>
    const $ = (id) => document.getElementById(id);
    async function j(url, init) {
      const r = await fetch(url, init);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || ('http_' + r.status));
      return data;
    }

    async function loadStatus() {
      const data = await j('/api/status');
      $('statusBox').textContent = JSON.stringify(data, null, 2);
    }

    async function loadMemories() {
      const p = new URLSearchParams();
      if ($('q').value.trim()) p.set('query', $('q').value.trim());
      if ($('scope').value) p.set('scope', $('scope').value);
      if ($('kind').value) p.set('kind', $('kind').value);
      p.set('limit', $('limit').value || '20');
      p.set('offset', $('offset').value || '0');
      const data = await j('/api/memories?' + p.toString());
      const counts = data.counts || {};
      $('kindStats').textContent = 'identity=' + (counts.identity || 0)
        + ' · task=' + (counts.task || 0)
        + ' · knowledge=' + (counts.knowledge || 0)
        + ' · reference=' + (counts.reference || 0)
        + ' · note=' + (counts.note || 0)
        + ' · unclassified=' + (counts.unclassified || 0);

      const rows = $('rows');
      rows.innerHTML = '';
      (data.items || []).forEach((it, idx) => {
        const tr = document.createElement('tr');
        tr.innerHTML = '<td>' + (idx + 1)
          + '</td><td><span class="pill">' + it.kind + '/' + it.scope
          + '</span><br><span class="muted">' + it.id
          + '</span></td><td>' + (it.content || '').replaceAll('<', '&lt;')
          + '</td><td></td>';
        const td = tr.lastElementChild;
        const del = document.createElement('button');
        del.textContent = '删除';
        del.className = 'secondary';
        del.onclick = async () => {
          if (!confirm('确认删除这条 memory?')) return;
          await j('/api/memory/' + encodeURIComponent(it.id), { method: 'DELETE' });
          await loadMemories();
        };
        td.appendChild(del);
        rows.appendChild(tr);
      });
    }

    $('btnStatus').onclick = () => loadStatus().catch(e => alert(e.message));
    $('btnSearch').onclick = () => loadMemories().catch(e => alert(e.message));

    $('btnRemember').onclick = async () => {
      const content = $('rememberContent').value.trim();
      if (!content) return alert('内容不能为空');
      const payload = {
        content,
        kind: $('rememberKind').value,
        scope: $('rememberScope').value,
      };
      const data = await j('/api/remember', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      $('rememberMsg').textContent = '已保存: ' + data.id + ' (' + data.kind + '/' + data.scope + ')';
      $('rememberContent').value = '';
      await loadMemories();
    };

    $('btnRecall').onclick = async () => {
      const query = $('recallQuery').value.trim();
      if (!query) return alert('query 不能为空');
      const limit = Number($('recallLimit').value || '8');
      const data = await j('/api/recall', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, limit }) });
      $('recallBox').textContent = JSON.stringify(data.items, null, 2);
    };

    $('btnAsk').onclick = async () => {
      const question = $('askQuestion').value.trim();
      if (!question) return alert('问题不能为空');
      $('askBox').textContent = 'thinking...';
      const data = await j('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
      $('askBox').textContent = data.answer || '';
    };

    loadStatus().catch(console.error);
    loadMemories().catch(console.error);
  </script>
</body>
</html>`;
}

function tryOpenBrowser(url: string): void {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" });
  } catch {
    // ignore
  }
}

export function startGuiServer(options?: { port?: number; open?: boolean }): void {
  const port = Math.max(1, Math.min(65535, options?.port ?? 50777));
  const html = getHtml();
  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, `http://127.0.0.1:${port}`);

    if (method === "GET" && url.pathname === "/") {
      sendHtml(res, html);
      return;
    }

    try {
      if (method === "GET" && url.pathname === "/api/status") {
        const [llm, embedding, rag] = await Promise.all([
          getLlmStatus(),
          getEmbeddingStatus(),
          getRagStatus(),
        ]);
        sendJson(res, 200, { llm, embedding, rag });
        return;
      }

      if (method === "GET" && url.pathname === "/api/memories") {
        const query = url.searchParams.get("query") ?? undefined;
        const scope = normalizeScope(url.searchParams.get("scope"));
        const kind = normalizeKind(url.searchParams.get("kind"));
        const limit = Math.max(1, Math.min(100, parseIntSafe(url.searchParams.get("limit"), 20)));
        const offset = Math.max(0, parseIntSafe(url.searchParams.get("offset"), 0));

        const [items, counts] = await Promise.all([
          listMemories({ query, scope, kind, limit, offset }),
          getMemoryKindCounts({ query, scope }),
        ]);
        sendJson(res, 200, { items, counts });
        return;
      }

      if (method === "GET" && url.pathname.startsWith("/api/memory/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/memory/".length)).trim();
        const item = await openMemory(id);
        if (!item) {
          sendJson(res, 404, { error: "memory_not_found" });
          return;
        }
        sendJson(res, 200, { item });
        return;
      }

      if (method === "POST" && url.pathname === "/api/remember") {
        const body = await readBody(req);
        const content = String(body.content ?? "").trim();
        if (!content) {
          sendJson(res, 400, { error: "empty_content" });
          return;
        }
        const kind = String(body.kind ?? "auto");
        const scope = normalizeScope(body.scope) ?? "global";
        const row = await remember(content, { kind, scope });
        sendJson(res, 200, { id: row.id, kind: row.kind, scope: row.scope });
        return;
      }

      if (method === "POST" && url.pathname === "/api/recall") {
        const body = await readBody(req);
        const query = String(body.query ?? "").trim();
        if (!query) {
          sendJson(res, 400, { error: "empty_query" });
          return;
        }
        const limitRaw = Number(body.limit ?? 8);
        const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(20, Math.floor(limitRaw))) : 8;
        const items = await recallScored(query, { limit });
        sendJson(res, 200, { items });
        return;
      }

      if (method === "POST" && url.pathname === "/api/ask") {
        const body = await readBody(req);
        const question = String(body.question ?? "").trim();
        if (!question) {
          sendJson(res, 400, { error: "empty_question" });
          return;
        }
        const answer = await ask(question);
        sendJson(res, 200, { answer });
        return;
      }

      if (method === "DELETE" && url.pathname.startsWith("/api/memory/")) {
        const id = decodeURIComponent(url.pathname.slice("/api/memory/".length)).trim();
        await forget(id);
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "internal_error";
      sendJson(res, 500, { error: message });
    }
  });

  server.listen(port, "127.0.0.1", () => {
    const url = `http://127.0.0.1:${port}`;
    console.log(`Roy GUI running at ${url}`);
    if (options?.open) tryOpenBrowser(url);
  });

  const shutdown = () => {
    console.log("\nShutting down GUI...");
    server.close(() => {
      console.log("GUI server closed.");
      process.exit(0);
    });
    // Force exit after 3s
    setTimeout(() => process.exit(1), 3000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
