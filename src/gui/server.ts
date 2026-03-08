import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, extname, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ask } from "@/provider/ask";
import {
  countMemoriesByKindAndLastDays,
  countMemoriesByLastDays,
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

const GUI_DIST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/gui");
const GUI_INDEX_PATH = resolve(GUI_DIST_DIR, "index.html");

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function sendJson(res: ServerResponse, code: number, payload: JsonObject): void {
  res.statusCode = code;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function sendHtml(res: ServerResponse, html: string, statusCode = 200): void {
  res.statusCode = statusCode;
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
  if (
    v === "identity" ||
    v === "task" ||
    v === "knowledge" ||
    v === "reference" ||
    v === "note" ||
    v === "unclassified"
  ) {
    return v;
  }
  return undefined;
}

function parseIntSafe(v: string | null, fallback: number): number {
  const n = Number(v ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function safeAssetPath(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const relative = normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const absolute = resolve(GUI_DIST_DIR, `.${relative}`);
  if (!absolute.startsWith(GUI_DIST_DIR)) return null;
  return absolute;
}

async function serveStaticAsset(pathname: string, res: ServerResponse): Promise<boolean> {
  const path = pathname === "/" ? "/index.html" : pathname;
  const absolute = safeAssetPath(path);
  if (!absolute) return false;

  try {
    const file = await readFile(absolute);
    const ext = extname(absolute).toLowerCase();
    res.statusCode = 200;
    res.setHeader("Content-Type", MIME_TYPES[ext] ?? "application/octet-stream");
    res.end(file);
    return true;
  } catch {
    return false;
  }
}

async function serveGuiShell(res: ServerResponse): Promise<void> {
  try {
    const html = await readFile(GUI_INDEX_PATH, "utf-8");
    sendHtml(res, html);
  } catch {
    sendHtml(
      res,
      [
        "<!doctype html>",
        '<html lang="en">',
        "<head><meta charset=\"utf-8\" /><title>GUI Build Missing</title></head>",
        "<body style=\"font-family: sans-serif; padding: 24px;\">",
        "<h1>GUI frontend not built</h1>",
        "<p>Run <code>pnpm gui:build</code>, then start <code>pnpm roy gui</code> again.</p>",
        "</body></html>",
      ].join(""),
      503,
    );
  }
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

  const server = createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const rawUrl = req.url ?? "/";
    const url = new URL(rawUrl, `http://127.0.0.1:${port}`);

    try {
      if (method === "GET" && url.pathname === "/api/status") {
        const [llm, embedding, rag] = await Promise.all([getLlmStatus(), getEmbeddingStatus(), getRagStatus()]);
        sendJson(res, 200, { llm, embedding, rag });
        return;
      }

      if (method === "GET" && url.pathname === "/api/memory-stats") {
        const days = Math.max(1, Math.min(30, parseIntSafe(url.searchParams.get("days"), 7)));
        const items = await countMemoriesByLastDays(days);
        sendJson(res, 200, { items });
        return;
      }

      if (method === "GET" && url.pathname === "/api/memory-stats-by-kind") {
        const days = Math.max(1, Math.min(30, parseIntSafe(url.searchParams.get("days"), 7)));
        const items = await countMemoriesByKindAndLastDays(days);
        sendJson(res, 200, { items });
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

      if (method === "GET" && !url.pathname.startsWith("/api/")) {
        const servedStatic = await serveStaticAsset(url.pathname, res);
        if (servedStatic) return;

        await serveGuiShell(res);
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
    setTimeout(() => process.exit(1), 3000).unref();
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
