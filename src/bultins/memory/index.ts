import {
  remember,
  recallScored,
  listMemories,
  getMemoryKindCounts,
  forget,
} from "@/rag";
import type { MemoryKind, MemoryScope } from "@/rag/types";

export type MemoryAction = "store" | "recall" | "summary" | "forget";

export type MemoryArgs = {
  action: MemoryAction;
  content?: string;
  query?: string;
  id?: string;
  kind?: string;
  scope?: string;
  limit?: number;
};

export type MemoryResult = {
  result_code: number;
  data?: unknown;
  stderr?: string;
};

export async function runMemory(args: MemoryArgs): Promise<MemoryResult> {
  const { action } = args;
  try {
    if (action === "store") {
      const content = typeof args.content === "string" ? args.content.trim() : "";
      if (!content) {
        return { result_code: -1, stderr: "content required for store" };
      }
      const kind = (args.kind ?? "auto") as MemoryKind;
      const scope = (args.scope ?? "global") as MemoryScope;
      const record = await remember(content, { kind, scope });
      return {
        result_code: 0,
        data: { id: record.id, kind: record.kind, scope: record.scope },
      };
    }
    if (action === "recall") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const limit = typeof args.limit === "number" ? args.limit : 8;
      const scored = await recallScored(query, { limit });
      const items = scored.map((s) => ({
        id: s.id,
        content: s.content,
        kind: s.kind,
        scope: s.scope,
        score: s.score.toFixed(3),
      }));
      return { result_code: 0, data: { items, count: items.length } };
    }
    if (action === "summary") {
      const scope = typeof args.scope === "string" ? (args.scope as MemoryScope) : undefined;
      const query = typeof args.query === "string" ? args.query : undefined;
      const counts = await getMemoryKindCounts({ scope, query });
      const list = await listMemories({
        scope,
        query,
        limit: 10,
        offset: 0,
      });
      return {
        result_code: 0,
        data: {
          kind_counts: counts,
          recent: list.map((m) => ({ id: m.id, content: m.content.slice(0, 80), kind: m.kind })),
        },
      };
    }
    if (action === "forget") {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      if (!id) {
        return { result_code: -1, stderr: "id required for forget" };
      }
      await forget(id);
      return { result_code: 0, data: { id } };
    }
    return { result_code: -1, stderr: `unknown_action:${action}` };
  } catch (e) {
    return {
      result_code: -1,
      stderr: e instanceof Error ? e.message : String(e),
    };
  }
}
