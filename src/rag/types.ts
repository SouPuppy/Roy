export type MemoryKind = "identity" | "task" | "knowledge" | "reference" | "note" | "unclassified";
export type MemoryScope = "session" | "project" | "global";

export type MemoryRecord = {
  id: string;
  parentId: string;
  chunkIndex: number;
  content: string;
  kind: MemoryKind;
  scope: MemoryScope;
  importance: number;
  tokenCount: number;
  recallCount: number;
  lastRecalledAt: number | null;
  validityScore: number;
  isNegative: boolean;
  createdAt: number;
  updatedAt: number;
  embedding: number[] | null;
};

export type MemorySummary = Omit<MemoryRecord, "embedding">;

export type MemoryListOptions = {
  query?: string;
  scope?: MemoryScope;
  kind?: MemoryKind;
  limit?: number;
  offset?: number;
};

export type RecallOptions = {
  limit?: number;
  recallLimit?: number;
  scope?: MemoryScope;
};

export type ScoredMemory = MemoryRecord & {
  vectorScore: number;
  lexicalScore: number;
  recencyScore: number;
  importanceScore: number;
  score: number;
};
