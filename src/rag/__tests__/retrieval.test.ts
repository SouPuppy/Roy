import test from "node:test";
import assert from "node:assert/strict";
import { rerankWithMMR, scoreCandidates } from "@/rag/retrieval";
import type { MemoryRecord } from "@/rag/types";

function record(id: string, content: string, embedding: number[]): MemoryRecord {
  const now = Date.now();
  return {
    id,
    parentId: `${id}_parent`,
    chunkIndex: 0,
    content,
    kind: "knowledge",
    scope: "global",
    importance: 0.6,
    tokenCount: 4,
    recallCount: 0,
    lastRecalledAt: null,
    validityScore: 1,
    isNegative: false,
    createdAt: now,
    updatedAt: now,
    embedding,
  };
}

test("scoreCandidates prefers lexical and vector hits", () => {
  const query = "freedom database";
  const items = [
    record("a", "freedom notes and memory", [1, 0, 0]),
    record("b", "database schema tuning", [0.9, 0.1, 0]),
    record("c", "unrelated topic", [0, 0, 1]),
  ];
  const scored = scoreCandidates(query, [1, 0, 0], items, new Set(["a", "b"]));
  assert.equal(scored.length, 3);
  const sorted = [...scored].sort((x, y) => y.score - x.score);
  assert.equal(sorted[0].id, "a");
});

test("rerankWithMMR keeps diversity", () => {
  const now = Date.now();
  const base: ReturnType<typeof scoreCandidates>[number][] = [
    { ...record("a", "a", [1, 0, 0]), vectorScore: 1, lexicalScore: 1, recencyScore: 1, importanceScore: 1, score: 0.99, updatedAt: now },
    { ...record("b", "b", [0.99, 0.01, 0]), vectorScore: 0.95, lexicalScore: 0.9, recencyScore: 1, importanceScore: 1, score: 0.97, updatedAt: now - 1 },
    { ...record("c", "c", [0, 1, 0]), vectorScore: 0.7, lexicalScore: 0.8, recencyScore: 1, importanceScore: 1, score: 0.94, updatedAt: now - 2 },
  ];
  const selected = rerankWithMMR(base, 2);
  assert.equal(selected.length, 2);
  const ids = new Set(selected.map((x) => x.id));
  assert.ok(ids.has("a"));
  assert.ok(ids.has("c"));
});
