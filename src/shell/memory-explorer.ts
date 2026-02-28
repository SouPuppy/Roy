import prompts from "prompts";
import { forget, getMemoryKindCounts, listMemories, openMemory } from "@/rag";
import type { MemoryKind, MemoryScope, MemorySummary } from "@/rag/types";

type ExplorerState = {
  query: string;
  scope: MemoryScope | "all";
  kind: MemoryKind | "all";
  limit: number;
  offset: number;
};

function truncate(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function formatItem(item: MemorySummary): string {
  const time = new Date(item.updatedAt).toLocaleDateString();
  const shortId = item.id.slice(0, 8);
  return `${shortId} · [${item.kind}/${item.scope}] ${truncate(item.content, 68)} · ${time}`;
}

function toFilters(state: ExplorerState) {
  return {
    query: state.query || undefined,
    scope: state.scope === "all" ? undefined : state.scope,
    kind: state.kind === "all" ? undefined : state.kind,
    limit: state.limit,
    offset: state.offset,
  };
}

function formatKindStats(counts: Record<MemoryKind, number>): string {
  return [
    `identity=${counts.identity}`,
    `task=${counts.task}`,
    `knowledge=${counts.knowledge}`,
    `reference=${counts.reference}`,
    `note=${counts.note}`,
    `unclassified=${counts.unclassified}`,
  ].join(" · ");
}

async function chooseSearch(state: ExplorerState): Promise<void> {
  const res = await prompts({
    type: "text",
    name: "query",
    message: "Search memories (empty = clear)",
    initial: state.query,
  });
  if (typeof res.query === "string") {
    state.query = res.query.trim();
    state.offset = 0;
  }
}

async function chooseFilter(state: ExplorerState): Promise<void> {
  const res = await prompts([
    {
      type: "select",
      name: "scope",
      message: "Filter scope",
      choices: [
        { title: "all", value: "all" },
        { title: "session", value: "session" },
        { title: "project", value: "project" },
        { title: "global", value: "global" },
      ],
      initial: ["all", "session", "project", "global"].indexOf(state.scope),
    },
    {
      type: "select",
      name: "kind",
      message: "Filter kind",
      choices: [
        { title: "all", value: "all" },
        { title: "identity", value: "identity" },
        { title: "task", value: "task" },
        { title: "knowledge", value: "knowledge" },
        { title: "reference", value: "reference" },
        { title: "note", value: "note" },
        { title: "unclassified", value: "unclassified" },
      ],
      initial: ["all", "identity", "task", "knowledge", "reference", "note", "unclassified"].indexOf(state.kind),
    },
    {
      type: "number",
      name: "limit",
      message: "Page size",
      initial: state.limit,
      min: 5,
      max: 50,
    },
  ]);
  if (res.scope) state.scope = res.scope;
  if (res.kind) state.kind = res.kind;
  if (typeof res.limit === "number" && Number.isFinite(res.limit)) {
    state.limit = Math.max(5, Math.min(50, Math.floor(res.limit)));
  }
  state.offset = 0;
}

async function openItem(item: MemorySummary): Promise<void> {
  const full = await openMemory(item.id);
  if (!full) {
    console.log(`\nMemory not found: ${item.id}\n`);
    return;
  }

  const act = await prompts({
    type: "select",
    name: "action",
    message: `Memory ${item.id}`,
    choices: [
      { title: "Open details", value: "open" },
      { title: "Delete memory", value: "delete" },
      { title: "Back", value: "back" },
    ],
  });
  if (act.action === "open") {
    console.log("\n================ Memory Detail ================");
    console.log(`ID:          ${full.id}`);
    console.log(`Parent:      ${full.parentId} #${full.chunkIndex}`);
    console.log(`Kind/Scope:  ${full.kind}/${full.scope}`);
    console.log(`Importance:  ${full.importance.toFixed(3)}`);
    console.log(`Validity:    ${full.validityScore.toFixed(3)}  Negative=${full.isNegative ? "yes" : "no"}`);
    console.log(`Recalls:     ${full.recallCount}`);
    console.log(`Updated:     ${new Date(full.updatedAt).toLocaleString()}`);
    console.log("-----------------------------------------------");
    console.log(full.content);
    console.log("===============================================\n");
  } else if (act.action === "delete") {
    const confirm = await prompts({
      type: "confirm",
      name: "ok",
      message: `Delete this memory?`,
      initial: false,
    });
    if (confirm.ok) {
      await forget(item.id);
      console.log(`\nDeleted memory: ${item.id}\n`);
    } else {
      console.log("\nDelete cancelled.\n");
    }
  }
}

async function openById(): Promise<string | null> {
  const res = await prompts({
    type: "text",
    name: "id",
    message: "Open by memory id",
  });
  const id = String(res.id ?? "").trim();
  return id || null;
}

export async function runMemoryExplorer(initial?: {
  query?: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  limit?: number;
}): Promise<void> {
  const state: ExplorerState = {
    query: initial?.query ?? "",
    scope: initial?.scope ?? "all",
    kind: initial?.kind ?? "all",
    limit: Math.max(5, Math.min(50, initial?.limit ?? 15)),
    offset: 0,
  };

  while (true) {
    const [items, kindCounts] = await Promise.all([
      listMemories(toFilters(state)),
      getMemoryKindCounts({
        query: state.query || undefined,
        scope: state.scope === "all" ? undefined : state.scope,
      }),
    ]);
    const page = Math.floor(state.offset / state.limit) + 1;
    const title = [
      `Memory Explorer · page ${page} · query="${state.query || "-"}" · scope=${state.scope} · kind=${state.kind} · size=${state.limit}`,
      `Kind stats: ${formatKindStats(kindCounts)}`,
    ].join("\n");
    const choices = items.map((item) => ({
      title: formatItem(item),
      value: `item:${item.id}`,
    }));
    if (items.length === 0) {
      choices.push({ title: "No results on this page", value: "action:none" });
    }
    choices.push(
      { title: "Search", value: "action:search" },
      { title: "Filter", value: "action:filter" },
      { title: "Reset filters", value: "action:reset" },
      { title: "Open by ID", value: "action:openById" },
      { title: "Next page", value: "action:next" },
      { title: "Previous page", value: "action:prev" },
      { title: "Exit", value: "action:exit" },
    );

    const pick = await prompts({
      type: "select",
      name: "value",
      message: title,
      choices,
      hint: "- Use arrow keys to scroll",
    });

    if (!pick.value || pick.value === "action:exit") return;
    if (pick.value === "action:none") continue;
    if (pick.value === "action:search") {
      await chooseSearch(state);
      continue;
    }
    if (pick.value === "action:filter") {
      await chooseFilter(state);
      continue;
    }
    if (pick.value === "action:reset") {
      state.query = "";
      state.scope = "all";
      state.kind = "all";
      state.offset = 0;
      continue;
    }
    if (pick.value === "action:openById") {
      const id = await openById();
      if (!id) continue;
      const memory = await openMemory(id);
      if (!memory) {
        console.log(`\nMemory not found: ${id}\n`);
        continue;
      }
      await openItem(memory);
      continue;
    }
    if (pick.value === "action:next") {
      state.offset += state.limit;
      continue;
    }
    if (pick.value === "action:prev") {
      state.offset = Math.max(0, state.offset - state.limit);
      continue;
    }
    if (String(pick.value).startsWith("item:")) {
      const id = String(pick.value).slice(5);
      const item = items.find((m) => m.id === id);
      if (item) await openItem(item);
    }
  }
}
