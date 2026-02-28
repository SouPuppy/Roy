import { embedTexts } from "@/rag/embedding";
import { cosine } from "@/rag/retrieval";
import { searchKindNeighbors, type KindNeighbor } from "@/rag/db";
import type { MemoryKind, MemoryScope } from "@/rag/types";

type ClassifiableKind = Exclude<MemoryKind, "unclassified">;
const KINDS: ClassifiableKind[] = ["identity", "task", "knowledge", "reference", "note"];
const CLASSIFY_CONFIDENCE_FALLBACK = 0.28;
const LEARNED_PROTOTYPE_MIN_CONFIDENCE = 0.93;
const PROTOTYPE_WEIGHT = 0.9;
const DENSITY_WEIGHT = 0.1;
const MAX_LEARNED_PROTOTYPES_PER_KIND = 64;

const KIND_PROTOTYPES: Record<ClassifiableKind, string[]> = {
  identity: [
    "I am Roy",
    "My name is Roy",
    "My profile",
    "About me",
    "I like coffee",
    "I prefer dark mode",
    "I enjoy coding at night",
    "I usually work late",
    "I often use TypeScript",
  ],
  task: [
    "Todo implement recall",
    "Fix bug",
    "Need to deploy",
    "Need to finish this task",
    "Next step is",
    "Plan to build",
    "Action item",
    "Deadline is tomorrow",
    "Ship this feature",
  ],
  knowledge: [
    "Tokyo is capital of Japan",
    "Eigen is C++ library",
    "SQLite is database",
    "TypeScript is a typed superset of JavaScript",
    "The Earth orbits the Sun",
    "Covariance measures how variables move together",
  ],
  reference: [
    "Documentation at https://",
    "API spec",
    "According to docs",
    "See docs at",
    "Official reference manual",
    "Readme and documentation",
    "RFC specification",
    "See docs at https://example.com/spec",
    "Reference link for API usage",
    "Specification and documentation reference",
    "This is a documentation reference",
  ],
  note: [
    "Quick note",
    "Idea:",
    "Draft:",
    "Scratch note",
    "Temporary memo",
    "Remember this",
    "Thought:",
    "Quick note: refactor retriever",
    "Note to self about implementation details",
    "Draft idea for future changes",
    "Personal short note for later",
  ],
};

const learnedPrototypes: Record<ClassifiableKind, number[][]> = {
  identity: [],
  task: [],
  knowledge: [],
  reference: [],
  note: [],
};

let prototypeEmbeddingsPromise: Promise<Record<ClassifiableKind, number[][]>> | null = null;

async function getPrototypeEmbeddings(): Promise<Record<ClassifiableKind, number[][]>> {
  if (!prototypeEmbeddingsPromise) {
    prototypeEmbeddingsPromise = (async () => {
      const out = {} as Record<ClassifiableKind, number[][]>;
      for (const kind of KINDS) {
        out[kind] = await embedTexts(KIND_PROTOTYPES[kind]);
      }
      return out;
    })();
  }
  return prototypeEmbeddingsPromise;
}

function prototypeScore(
  memoryEmbedding: number[],
  kind: ClassifiableKind,
  prototypes: Record<ClassifiableKind, number[][]>,
): number {
  const all = [...prototypes[kind], ...learnedPrototypes[kind]];
  if (all.length === 0) return 0;
  let best = -1;
  for (const p of all) {
    const score = Math.max(0, cosine(memoryEmbedding, p));
    if (score > best) best = score;
  }
  return Math.max(0, best);
}

function densityScore(neighbors: KindNeighbor[]): Record<ClassifiableKind, number> {
  const weightedSum: Record<ClassifiableKind, number> = {
    identity: 0,
    task: 0,
    knowledge: 0,
    reference: 0,
    note: 0,
  };
  const counts: Record<ClassifiableKind, number> = {
    identity: 0,
    task: 0,
    knowledge: 0,
    reference: 0,
    note: 0,
  };
  for (const n of neighbors) {
    if (!KINDS.includes(n.kind as ClassifiableKind)) continue;
    const k = n.kind as ClassifiableKind;
    weightedSum[k] += n.score;
    counts[k] += 1;
  }
  // Use per-kind average (not sum) to avoid majority-class collapse.
  const out: Record<ClassifiableKind, number> = {
    identity: 0,
    task: 0,
    knowledge: 0,
    reference: 0,
    note: 0,
  };
  for (const kind of KINDS) {
    out[kind] = counts[kind] > 0 ? weightedSum[kind] / counts[kind] : 0;
  }
  return out;
}

export async function inferKindByEmbedding(
  memoryEmbedding: number[],
  scope?: MemoryScope,
): Promise<{ kind: MemoryKind; confidence: number }> {
  if (memoryEmbedding.length === 0) {
    return { kind: "unclassified", confidence: 0 };
  }

  const [prototypes, neighbors] = await Promise.all([
    getPrototypeEmbeddings(),
    searchKindNeighbors(memoryEmbedding, 20, scope),
  ]);
  const density = densityScore(neighbors);
  const prototypeOnly = {} as Record<ClassifiableKind, number>;
  for (const kind of KINDS) {
    prototypeOnly[kind] = prototypeScore(memoryEmbedding, kind, prototypes);
  }

  // If prototype anchor is clear, trust it directly.
  const topTwo = [...KINDS]
    .map((k) => ({ kind: k, score: prototypeOnly[k] }))
    .sort((a, b) => b.score - a.score);
  if (topTwo[0] && topTwo[1]) {
    const margin = topTwo[0].score - topTwo[1].score;
    if (topTwo[0].score >= 0.52 && margin >= 0.045) {
      const chosen = topTwo[0].kind;
      if (topTwo[0].score > LEARNED_PROTOTYPE_MIN_CONFIDENCE) {
        if (learnedPrototypes[chosen].length >= MAX_LEARNED_PROTOTYPES_PER_KIND) {
          learnedPrototypes[chosen].shift();
        }
        learnedPrototypes[chosen].push([...memoryEmbedding]);
      }
      return { kind: chosen, confidence: topTwo[0].score };
    }
  }

  let bestKind: ClassifiableKind = "knowledge";
  let bestScore = -Infinity;

  for (const kind of KINDS) {
    const pScore = prototypeOnly[kind];
    const dScore = density[kind] ?? 0;
    // Density is only trusted when the prototype is at least moderately aligned.
    const gatedDensity = pScore >= 0.35 ? dScore : dScore * 0.25;
    const score = PROTOTYPE_WEIGHT * pScore + DENSITY_WEIGHT * gatedDensity;
    if (score > bestScore) {
      bestScore = score;
      bestKind = kind;
    }
  }

  const confidence = Number.isFinite(bestScore) ? bestScore : 0;
  const finalKind: MemoryKind =
    confidence < CLASSIFY_CONFIDENCE_FALLBACK ? "unclassified" : bestKind;

  // Self-learning prototype expansion.
  if (finalKind !== "unclassified" && confidence > LEARNED_PROTOTYPE_MIN_CONFIDENCE) {
    if (learnedPrototypes[finalKind].length >= MAX_LEARNED_PROTOTYPES_PER_KIND) {
      learnedPrototypes[finalKind].shift();
    }
    learnedPrototypes[finalKind].push([...memoryEmbedding]);
  }

  return { kind: finalKind, confidence };
}
