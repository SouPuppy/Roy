import { randomUUID } from "crypto";
import { chunkText, estimateTokenCount } from "@/rag/chunk";
import { embedText, embedTexts } from "@/rag/embedding";
import {
  bumpRecallMetrics,
  countMemories,
  findSemanticDuplicate,
  getRagStorageStatus,
  insertMemoryRows,
  loadMemoriesByIds,
  loadSiblingChunks,
  mergeIntoExistingMemory,
  searchFtsIds,
  searchVectorIds,
} from "@/rag/db";
import { expandQuery } from "@/rag/query";
import { rerankWithMMR, scoreCandidates } from "@/rag/retrieval";
import type { MemoryRecord, RecallOptions, ScoredMemory } from "@/rag/types";

export type { MemoryRecord, RecallOptions } from "@/rag/types";

function dynamicRecallLimit(total: number, preferred?: number): number {
  if (preferred && preferred > 0) return preferred;
  if (total > 50000) return 200;
  if (total > 5000) return 100;
  return 50;
}

async function expandSiblings(scored: ScoredMemory[], window = 1): Promise<ScoredMemory[]> {
  if (scored.length === 0) return scored;
  const out = new Map(scored.map((s) => [s.id, s]));
  for (const item of scored) {
    const siblings = await loadSiblingChunks(item.parentId, item.chunkIndex, window);
    for (const sibling of siblings) {
      if (out.has(sibling.id)) continue;
      out.set(sibling.id, {
        ...sibling,
        vectorScore: Math.max(0, item.vectorScore - 0.08),
        lexicalScore: Math.max(0, item.lexicalScore - 0.05),
        recencyScore: item.recencyScore,
        importanceScore: item.importanceScore,
        score: Math.max(0, item.score - 0.1),
      });
    }
  }
  return [...out.values()];
}

export async function remember(
  content: string,
  options?: {
    kind?: string;
    scope?: string;
    importance?: number;
    validityScore?: number;
    isNegative?: boolean;
  },
): Promise<MemoryRecord> {
  const normalized = content.trim();
  if (!normalized) {
    throw new Error("empty_memory_content");
  }
  const now = Date.now();
  const parentId = randomUUID();
  const scope = (options?.scope ?? "global") as MemoryRecord["scope"];
  const chunks = await chunkText(normalized, 220, 40);
  if (chunks.length === 0) {
    throw new Error("empty_memory_chunks");
  }
  const embeddings = await embedTexts(chunks);

  const rows: MemoryRecord[] = [];
  let firstExisting: MemoryRecord | null = null;
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index];
    const embedding = embeddings[index] ?? null;
    const tokenCount = await estimateTokenCount(chunk);
    const duplicate = embedding ? await findSemanticDuplicate(embedding, scope, 0.95) : null;
    if (duplicate) {
      await mergeIntoExistingMemory(duplicate.id, {
        content: chunk,
        importance: options?.importance ?? 0.5,
        updatedAt: now,
        embedding,
        tokenCount,
      });
      firstExisting = firstExisting ?? duplicate;
      continue;
    }
    rows.push({
      id: randomUUID(),
      parentId,
      chunkIndex: index,
      content: chunk,
      embedding,
      kind: (options?.kind ?? "knowledge") as MemoryRecord["kind"],
      scope,
      importance: options?.importance ?? 0.5,
      tokenCount,
      recallCount: 0,
      lastRecalledAt: null,
      validityScore: Math.max(0, Math.min(1, options?.validityScore ?? 1)),
      isNegative: options?.isNegative ?? false,
      createdAt: now,
      updatedAt: now,
    });
  }

  await insertMemoryRows(rows);
  if (rows[0]) return rows[0];
  if (firstExisting) return firstExisting;
  throw new Error("remember_noop");
}

export async function recallScored(
  query: string,
  options?: RecallOptions,
): Promise<ScoredMemory[]> {
  const limit = options?.limit ?? 8;
  const corpusSize = await countMemories(options?.scope);
  const recallLimit = dynamicRecallLimit(corpusSize, options?.recallLimit);

  const queries = expandQuery(query);
  const embeddings = await embedTexts(queries);
  const queryEmbedding = embeddings[0] ?? (await embedText(query));

  const vectorIds = new Set<string>();
  const lexicalIds = new Set<string>();
  const perBranchLimit = Math.max(recallLimit, limit * 8);
  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const emb = embeddings[i];
    const [annIds, ftsIds] = await Promise.all([
      searchVectorIds(emb, perBranchLimit, options?.scope),
      searchFtsIds(q, perBranchLimit),
    ]);
    for (const id of annIds) vectorIds.add(id);
    for (const id of ftsIds) lexicalIds.add(id);
  }
  const candidateIds = [...new Set([...vectorIds, ...lexicalIds])];
  const memories = await loadMemoriesByIds(candidateIds);

  const scored = scoreCandidates(query, queryEmbedding, memories, lexicalIds)
    .sort((a, b) => b.score - a.score)
    .slice(0, recallLimit);

  const reranked = rerankWithMMR(scored, limit);
  const expanded = await expandSiblings(reranked, 1);
  const final = rerankWithMMR(expanded, limit);
  await bumpRecallMetrics(final.map((m) => m.id));
  return final;
}

export async function recall(query: string, options?: RecallOptions): Promise<MemoryRecord[]> {
  const scored = await recallScored(query, options);
  return scored.map(({ vectorScore: _v, lexicalScore: _l, recencyScore: _r, importanceScore: _i, score: _s, ...m }) => m);
}

export async function buildContext(query: string, limit = 5, maxChars = 2400): Promise<string> {
  const memories = await recallScored(query, { limit, recallLimit: Math.max(30, limit * 6) });
  if (memories.length === 0) return "";

  const grouped = new Map<
    string,
    { score: number; kind: string; scope: string; chunks: Array<{ index: number; content: string }> }
  >();
  for (const m of memories) {
    if (!grouped.has(m.parentId)) {
      grouped.set(m.parentId, {
        score: m.score,
        kind: m.kind,
        scope: m.scope,
        chunks: [],
      });
    }
    const item = grouped.get(m.parentId)!;
    item.score = Math.max(item.score, m.score);
    item.chunks.push({ index: m.chunkIndex, content: m.content });
  }

  const parentBlocks = [...grouped.values()]
    .map((group) => {
      const merged = group.chunks
        .sort((a, b) => a.index - b.index)
        .map((c) => c.content)
        .join(" ");
      return {
        score: group.score,
        text: `- (${group.kind}/${group.scope}|score=${group.score.toFixed(3)}) ${merged}`,
      };
    })
    .sort((a, b) => b.score - a.score);

  const parts: string[] = [];
  let total = 0;
  for (const block of parentBlocks.map((x) => x.text)) {
    if (total + block.length > maxChars) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join("\n");
}

export async function rememberConversation(question: string, answer: string): Promise<void> {
  await remember(`User: ${question}`, { kind: "conversation", scope: "session", importance: 0.6 });
  await remember(`Assistant: ${answer}`, { kind: "conversation", scope: "session", importance: 0.6 });
}

export async function getRagStatus(): Promise<{
  storage: Awaited<ReturnType<typeof getRagStorageStatus>>;
}> {
  const storage = await getRagStorageStatus();
  return { storage };
}
