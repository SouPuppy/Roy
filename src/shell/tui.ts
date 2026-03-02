import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { ask } from "@/provider/ask";
import { getLlmStatus } from "@/provider";
import { getEmbeddingStatus } from "@/rag/embedding";
import {
  forget,
  getMemoryKindCounts,
  getRagStatus,
  listMemories,
  openMemory,
  recallScored,
  remember,
} from "@/rag";
import type { MemoryKind, MemoryScope } from "@/rag/types";

type ActiveScreen = "main" | "chat" | "memory" | "recall" | "status";

type AppState = {
  activeScreen: ActiveScreen;
  memoryFilters: {
    query: string;
    scope: MemoryScope | "all";
    kind: MemoryKind | "all";
    limit: number;
    offset: number;
  };
  recallSettings: {
    mode: "accurate" | "reelated";
    limit: number;
  };
  lastError: string | null;
};

const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const PAGE_SIZE = 10;

type RL = ReturnType<typeof createInterface>;

function normalizeScope(v: string): MemoryScope | "all" {
  if (v === "session" || v === "project" || v === "global") return v;
  return "all";
}

function normalizeKind(v: string): MemoryKind | "all" {
  if (v === "identity" || v === "task" || v === "knowledge" || v === "reference" || v === "note" || v === "unclassified") {
    return v;
  }
  return "all";
}

function toInt(v: string, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

function truncate(text: string, max = 96): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function clearScreen(): void {
  output.write("\x1Bc");
}

async function pause(rl: RL): Promise<void> {
  await rl.question("\n按回车继续...");
}

async function askNumber(rl: RL, label: string): Promise<number> {
  const v = (await rl.question(label)).trim();
  return toInt(v, NaN);
}

async function showPagedText(rl: RL, text: string, title = "详情"): Promise<void> {
  const lines = text.split(/\r?\n/);
  let page = 0;
  while (true) {
    clearScreen();
    const totalPages = Math.max(1, Math.ceil(lines.length / PAGE_SIZE));
    const start = page * PAGE_SIZE;
    const chunk = lines.slice(start, start + PAGE_SIZE);
    console.log(`=== ${title} (第 ${page + 1}/${totalPages} 页) ===\n`);
    console.log(chunk.join("\n") || "(空)");

    if (page + 1 >= totalPages) {
      console.log("\n0) 返回");
      const c = await askNumber(rl, "> ");
      if (c === 0) return;
      continue;
    }

    console.log("\n1) 下一页");
    console.log("0) 返回");
    const c = await askNumber(rl, "> ");
    if (c === 1) {
      page += 1;
      continue;
    }
    if (c === 0) return;
  }
}

function printError(state: AppState): void {
  if (!state.lastError) return;
  console.log(`${RED}错误: ${state.lastError}${RESET}`);
}

async function runChat(rl: RL, state: AppState): Promise<void> {
  state.activeScreen = "chat";
  while (true) {
    clearScreen();
    console.log("=== Chat ===");
    printError(state);
    state.lastError = null;
    console.log("1) 提问");
    console.log("0) 返回");

    const choice = await askNumber(rl, "> ");
    if (choice === 0) return;
    if (choice !== 1) continue;

    const question = (await rl.question("输入问题: ")).trim();
    if (!question) {
      state.lastError = "问题不能为空";
      continue;
    }

    try {
      const answer = await ask(question);
      await showPagedText(rl, answer, "回答");
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "ask_failed";
    }
  }
}

function memoryFilterText(state: AppState): string {
  const f = state.memoryFilters;
  return `query=${f.query || "-"} · scope=${f.scope} · kind=${f.kind} · limit=${f.limit} · offset=${f.offset}`;
}

async function openMemoryByIdFlow(rl: RL, state: AppState, id: string): Promise<void> {
  const memory = await openMemory(id);
  if (!memory) {
    state.lastError = `memory_not_found: ${id}`;
    return;
  }
  const header = [
    `ID: ${memory.id}`,
    `Parent: ${memory.parentId} #${memory.chunkIndex}`,
    `Kind/Scope: ${memory.kind}/${memory.scope}`,
    `Importance: ${memory.importance.toFixed(3)} · Validity: ${memory.validityScore.toFixed(3)} · Recalls: ${memory.recallCount}`,
    `Updated: ${new Date(memory.updatedAt).toLocaleString()}`,
    "",
  ].join("\n");
  await showPagedText(rl, header + memory.content, "Memory 详情");
}

async function runMemoryList(rl: RL, state: AppState): Promise<void> {
  while (true) {
    const f = state.memoryFilters;
    const query = f.query || undefined;
    const scope = f.scope === "all" ? undefined : f.scope;
    const kind = f.kind === "all" ? undefined : f.kind;

    const [rows, counts] = await Promise.all([
      listMemories({ query, scope, kind, limit: f.limit, offset: f.offset }),
      getMemoryKindCounts({ query, scope }),
    ]);

    clearScreen();
    console.log("=== Memory / List ===");
    printError(state);
    state.lastError = null;
    console.log(memoryFilterText(state));
    console.log(`${DIM}identity=${counts.identity} · task=${counts.task} · knowledge=${counts.knowledge} · reference=${counts.reference} · note=${counts.note} · unclassified=${counts.unclassified}${RESET}`);
    console.log("");

    if (rows.length === 0) {
      console.log("(当前页无结果)\n");
    } else {
      rows.forEach((row, i) => {
        console.log(`${i + 1}. [${row.kind}/${row.scope}] ${truncate(row.content)}`);
        console.log(`   id=${row.id}`);
      });
      console.log("");
    }

    console.log("1) 下一页");
    console.log("2) 上一页");
    console.log("3) 打开条目(按序号)");
    console.log("0) 返回");
    const c = await askNumber(rl, "> ");
    if (c === 0) return;
    if (c === 1) {
      f.offset += f.limit;
      continue;
    }
    if (c === 2) {
      f.offset = Math.max(0, f.offset - f.limit);
      continue;
    }
    if (c === 3) {
      const idx = await askNumber(rl, "输入序号: ");
      const row = rows[idx - 1];
      if (!row) {
        state.lastError = "无效序号";
        continue;
      }
      await openMemoryByIdFlow(rl, state, row.id);
      continue;
    }
  }
}

async function runMemorySearch(rl: RL, state: AppState): Promise<void> {
  clearScreen();
  console.log("=== Memory / Search ===");
  console.log("留空表示不变；scope: all/session/project/global；kind: all/identity/task/knowledge/reference/note/unclassified\n");
  const f = state.memoryFilters;

  const query = (await rl.question(`query (${f.query || "-"}): `)).trim();
  const scope = (await rl.question(`scope (${f.scope}): `)).trim().toLowerCase();
  const kind = (await rl.question(`kind (${f.kind}): `)).trim().toLowerCase();
  const limit = (await rl.question(`limit (${f.limit}): `)).trim();

  if (query) f.query = query;
  if (scope) f.scope = normalizeScope(scope);
  if (kind) f.kind = normalizeKind(kind);
  if (limit) {
    const next = toInt(limit, f.limit);
    f.limit = Math.max(1, Math.min(50, next));
  }
  f.offset = 0;
}

async function runMemoryAdd(rl: RL, state: AppState): Promise<void> {
  clearScreen();
  console.log("=== Memory / Add ===\n");
  const content = (await rl.question("content: ")).trim();
  if (!content) {
    state.lastError = "content 不能为空";
    return;
  }
  const kind = (await rl.question("kind(auto/identity/task/knowledge/reference/note/unclassified, 默认auto): ")).trim();
  const scopeRaw = (await rl.question("scope(global/project/session, 默认global): ")).trim().toLowerCase();
  const scope = normalizeScope(scopeRaw);

  const record = await remember(content, {
    kind: kind || "auto",
    scope: scope === "all" ? "global" : scope,
  });
  console.log(`\n已保存: ${record.id} [${record.kind}/${record.scope}]`);
  await pause(rl);
}

async function runMemoryDelete(rl: RL, state: AppState): Promise<void> {
  clearScreen();
  console.log("=== Memory / Delete ===\n");
  const id = (await rl.question("memory id: ")).trim();
  if (!id) {
    state.lastError = "id 不能为空";
    return;
  }
  console.log("1) 确认删除");
  console.log("0) 取消");
  const c = await askNumber(rl, "> ");
  if (c !== 1) return;
  await forget(id);
  console.log(`已删除: ${id}`);
  await pause(rl);
}

async function runMemory(rl: RL, state: AppState): Promise<void> {
  state.activeScreen = "memory";
  while (true) {
    clearScreen();
    console.log("=== Memory ===");
    printError(state);
    state.lastError = null;
    console.log(memoryFilterText(state));
    console.log("1) List(分页)");
    console.log("2) Search(设置过滤)");
    console.log("3) Add");
    console.log("4) Open by ID");
    console.log("5) Delete by ID");
    console.log("0) 返回");

    const c = await askNumber(rl, "> ");
    try {
      if (c === 0) return;
      if (c === 1) {
        await runMemoryList(rl, state);
        continue;
      }
      if (c === 2) {
        await runMemorySearch(rl, state);
        continue;
      }
      if (c === 3) {
        await runMemoryAdd(rl, state);
        continue;
      }
      if (c === 4) {
        const id = (await rl.question("memory id: ")).trim();
        if (!id) {
          state.lastError = "id 不能为空";
          continue;
        }
        await openMemoryByIdFlow(rl, state, id);
        continue;
      }
      if (c === 5) {
        await runMemoryDelete(rl, state);
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "memory_action_failed";
    }
  }
}

async function runRecall(rl: RL, state: AppState): Promise<void> {
  state.activeScreen = "recall";
  while (true) {
    clearScreen();
    console.log("=== Recall ===");
    printError(state);
    state.lastError = null;
    console.log(`mode=${state.recallSettings.mode} · limit=${state.recallSettings.limit}`);
    console.log("1) 运行 Recall");
    console.log("2) 切换模式 accurate/reelated");
    console.log("3) 设置 limit");
    console.log("0) 返回");

    const c = await askNumber(rl, "> ");
    if (c === 0) return;

    try {
      if (c === 2) {
        state.recallSettings.mode = state.recallSettings.mode === "accurate" ? "reelated" : "accurate";
        continue;
      }
      if (c === 3) {
        const n = await askNumber(rl, "limit: ");
        if (Number.isFinite(n)) {
          state.recallSettings.limit = Math.max(1, Math.min(20, n));
        }
        continue;
      }
      if (c === 1) {
        const query = (await rl.question("query: ")).trim();
        if (!query) {
          state.lastError = "query 不能为空";
          continue;
        }

        const mode = state.recallSettings.mode;
        const baseLimit = mode === "reelated" ? 16 : 8;
        const scored = await recallScored(query, { limit: Math.max(baseLimit, state.recallSettings.limit) });
        if (scored.length === 0) {
          console.log("\nNo memories found.");
          await pause(rl);
          continue;
        }

        const best = scored[0]?.score ?? 0;
        const settings = mode === "accurate"
          ? { minAbs: 0.2, ratio: 0.58, max: state.recallSettings.limit }
          : { minAbs: 0.12, ratio: 0.35, max: state.recallSettings.limit };
        const minScore = Math.max(settings.minAbs, best * settings.ratio);
        const auto = scored.filter((m, i) => i === 0 || m.score >= minScore).slice(0, settings.max);

        const lines: string[] = [];
        lines.push(`query=${query}`);
        lines.push(`mode=${mode} · selected=${auto.length}`);
        lines.push("");
        for (const [i, m] of auto.entries()) {
          lines.push(`${i + 1}. [${m.kind}/${m.scope}] ${m.content}`);
          lines.push(`   score=${m.score.toFixed(3)} vector=${m.vectorScore.toFixed(3)} lexical=${m.lexicalScore.toFixed(3)} importance=${m.importanceScore.toFixed(3)} recency=${m.recencyScore.toFixed(3)}`);
          lines.push(`   id=${m.id}`);
        }

        await showPagedText(rl, lines.join("\n"), "Recall 结果");
      }
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "recall_failed";
    }
  }
}

async function runStatus(rl: RL, state: AppState): Promise<void> {
  state.activeScreen = "status";
  while (true) {
    try {
      clearScreen();
      const [llm, embedding, rag] = await Promise.all([
        getLlmStatus(),
        getEmbeddingStatus(),
        getRagStatus(),
      ]);
      console.log("=== Status ===\n");
      console.log(JSON.stringify({ llm, embedding, rag }, null, 2));
      console.log("\n1) 刷新");
      console.log("0) 返回");
      const c = await askNumber(rl, "> ");
      if (c === 0) return;
    } catch (error) {
      state.lastError = error instanceof Error ? error.message : "status_failed";
      console.log(`${RED}错误: ${state.lastError}${RESET}`);
      await pause(rl);
    }
  }
}

export async function runTui(): Promise<void> {
  const rl = createInterface({ input, output });
  const state: AppState = {
    activeScreen: "main",
    memoryFilters: {
      query: "",
      scope: "all",
      kind: "all",
      limit: 10,
      offset: 0,
    },
    recallSettings: {
      mode: "accurate",
      limit: 8,
    },
    lastError: null,
  };

  try {
    while (true) {
      state.activeScreen = "main";
      clearScreen();
      console.log("=== Roy TUI ===");
      printError(state);
      state.lastError = null;
      console.log("1) Chat");
      console.log("2) Memory");
      console.log("3) Recall");
      console.log("4) Status");
      console.log("0) Exit");

      const c = await askNumber(rl, "> ");
      if (c === 0) break;

      if (c === 1) {
        await runChat(rl, state);
        continue;
      }
      if (c === 2) {
        await runMemory(rl, state);
        continue;
      }
      if (c === 3) {
        await runRecall(rl, state);
        continue;
      }
      if (c === 4) {
        await runStatus(rl, state);
      }
    }
  } finally {
    rl.close();
  }
}
