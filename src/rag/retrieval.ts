import type { MemoryRecord, ScoredMemory } from "@/rag/types";

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function lexicalScore(query: string, content: string): number {
  const q = tokenize(query);
  const cTokens = tokenize(content);
  const set = new Set(cTokens);
  if (q.length === 0) return 0;
  let hit = 0;
  for (const token of q) {
    if (set.has(token)) hit++;
  }
  const overlap = hit / q.length;
  const contains = content.toLowerCase().includes(query.toLowerCase()) ? 0.3 : 0;
  return Math.min(1, overlap + contains);
}

function recencyScore(updatedAt: number): number {
  const ageHours = Math.max(1, (Date.now() - updatedAt) / 3600000);
  return Math.min(1, 24 / ageHours);
}

function effectiveImportance(importance: number, updatedAt: number): number {
  const ageDays = Math.max(0, (Date.now() - updatedAt) / 86400000);
  const decay = Math.pow(0.99, ageDays);
  const normalized = Math.max(0, Math.min(1, importance));
  return normalized * decay;
}

export function scoreCandidates(
  query: string,
  queryEmbedding: number[] | null,
  memories: MemoryRecord[],
  lexicalHitIds: Set<string>,
): ScoredMemory[] {
  return memories.map((m) => {
    const vectorScore =
      queryEmbedding && m.embedding ? Math.max(0, cosine(queryEmbedding, m.embedding)) : 0;
    const lexical = lexicalScore(query, m.content);
    const lexicalBoost = lexicalHitIds.has(m.id) ? Math.min(1, lexical + 0.4) : lexical;
    const recency = recencyScore(m.updatedAt);
    const importance = effectiveImportance(m.importance, m.updatedAt);
    const validity = Math.max(0, Math.min(1, m.validityScore ?? 1));
    const negativePenalty = m.isNegative ? 0.25 : 0;

    const score =
      0.6 * vectorScore +
      0.2 * lexicalBoost +
      0.1 * importance +
      0.1 * recency;

    const adjusted = Math.max(0, score * validity - negativePenalty);

    return {
      ...m,
      vectorScore,
      lexicalScore: lexicalBoost,
      recencyScore: recency,
      importanceScore: importance,
      score: adjusted,
    };
  });
}

export function rerankWithMMR(
  candidates: ScoredMemory[],
  limit: number,
  lambda = 0.75,
): ScoredMemory[] {
  if (candidates.length <= limit) return candidates;
  const selected: ScoredMemory[] = [];
  const pool = [...candidates].sort((a, b) => b.score - a.score);

  while (selected.length < limit && pool.length > 0) {
    let bestIndex = 0;
    let bestValue = -Infinity;

    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      const maxSimilarity =
        selected.length === 0
          ? 0
          : Math.max(
              ...selected.map((s) =>
                cand.embedding && s.embedding ? Math.max(0, cosine(cand.embedding, s.embedding)) : 0,
              ),
            );
      const mmrValue = lambda * cand.score - (1 - lambda) * maxSimilarity;
      if (mmrValue > bestValue) {
        bestValue = mmrValue;
        bestIndex = i;
      }
    }

    const [picked] = pool.splice(bestIndex, 1);
    selected.push(picked);
  }

  return selected.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.id.localeCompare(b.id);
  });
}
