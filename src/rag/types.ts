export type MemoryKind = "knowledge" | "conversation" | "document" | "note";
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
