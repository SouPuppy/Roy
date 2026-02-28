import Database from "better-sqlite3";
import { join } from "path";
import { getHomeDir } from "@/home";
import type { MemoryKind, MemoryListOptions, MemoryRecord, MemoryScope, MemorySummary } from "@/rag/types";
import { cosine } from "@/rag/retrieval";
import { deleteEmbedding, initializeAnn, searchNearest, type AnnStatus, upsertEmbedding } from "@/rag/ann";

const MEMORY_DB_FILENAME = "memory.db";
const SCHEMA_VERSION = 2;
const DEDUP_CANDIDATE_LIMIT = 12;

type StoredRow = {
  id: string;
  parent_id: string;
  chunk_index: number;
  content: string;
  embedding_json: string | null;
  kind: string;
  scope: string;
  importance: number;
  token_count: number;
  recall_count: number;
  last_recalled_at: number | null;
  validity_score: number;
  is_negative: number;
  created_at: number;
  updated_at: number;
};

export type RagStorageStatus = {
  path: string;
  ann: AnnStatus;
  corpusSize: number;
};

export type KindNeighbor = {
  kind: MemoryKind;
  score: number;
};

const MEMORY_KINDS: MemoryKind[] = ["identity", "task", "knowledge", "reference", "note", "unclassified"];

let dbSingleton: Database.Database | null = null;
let annStatus: AnnStatus = { enabled: false, message: "uninitialized" };

function getDbPath(): string {
  return join(getHomeDir(), MEMORY_DB_FILENAME);
}

function getDb(): Database.Database {
  if (dbSingleton) return dbSingleton;
  const db = new Database(getDbPath());
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("temp_store = MEMORY");
  ensureSchema(db);
  annStatus = initializeAnn(db);
  syncAnnIndex(db);
  dbSingleton = db;
  return db;
}

function hasColumn(db: Database.Database, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table});`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === column);
}

function ensureSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO schema_version(id, version) VALUES (1, 0);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_records (
      id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL DEFAULT 0,
      content TEXT NOT NULL,
      embedding_json TEXT,
      kind TEXT NOT NULL DEFAULT 'knowledge',
      scope TEXT NOT NULL DEFAULT 'global',
      importance REAL NOT NULL DEFAULT 0.5,
      token_count INTEGER NOT NULL DEFAULT 0,
      recall_count INTEGER NOT NULL DEFAULT 0,
      last_recalled_at INTEGER,
      validity_score REAL NOT NULL DEFAULT 1.0,
      is_negative INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  // forward-compatible migrations for earlier schema versions
  if (!hasColumn(db, "memory_records", "parent_id")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN parent_id TEXT NOT NULL DEFAULT ''`);
    db.exec(`UPDATE memory_records SET parent_id = id WHERE parent_id = ''`);
  }
  if (!hasColumn(db, "memory_records", "chunk_index")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN chunk_index INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "memory_records", "embedding_json")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN embedding_json TEXT`);
  }
  if (!hasColumn(db, "memory_records", "token_count")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN token_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "memory_records", "recall_count")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0`);
  }
  if (!hasColumn(db, "memory_records", "last_recalled_at")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN last_recalled_at INTEGER`);
  }
  if (!hasColumn(db, "memory_records", "validity_score")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN validity_score REAL NOT NULL DEFAULT 1.0`);
  }
  if (!hasColumn(db, "memory_records", "is_negative")) {
    db.exec(`ALTER TABLE memory_records ADD COLUMN is_negative INTEGER NOT NULL DEFAULT 0`);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memory_scope_updated
    ON memory_records(scope, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memory_parent_chunk
    ON memory_records(parent_id, chunk_index ASC);
    CREATE INDEX IF NOT EXISTS idx_memory_validity
    ON memory_records(validity_score DESC);
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
      USING fts5(id UNINDEXED, content);
    `);
  } catch {
    // optional
  }

  const current = db.prepare(`SELECT version FROM schema_version WHERE id = 1`).get() as { version: number };
  if (current.version < SCHEMA_VERSION) {
    db.prepare(`UPDATE schema_version SET version = ? WHERE id = 1`).run(SCHEMA_VERSION);
  }
}

function parseRow(row: StoredRow): MemoryRecord {
  let embedding: number[] | null = null;
  if (row.embedding_json) {
    try {
      embedding = JSON.parse(row.embedding_json) as number[];
    } catch {
      embedding = null;
    }
  }
  return {
    id: row.id,
    parentId: row.parent_id,
    chunkIndex: row.chunk_index,
    content: row.content,
    embedding,
    kind: row.kind as MemoryRecord["kind"],
    scope: row.scope as MemoryScope,
    importance: Number(row.importance),
    tokenCount: Number(row.token_count),
    recallCount: Number(row.recall_count),
    lastRecalledAt: row.last_recalled_at ?? null,
    validityScore: Number(row.validity_score),
    isNegative: Boolean(row.is_negative),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

function syncAnnIndex(db: Database.Database): void {
  if (!annStatus.enabled) return;
  try {
    const rows = db.prepare(`
      SELECT id, scope, embedding_json
      FROM memory_records
      WHERE embedding_json IS NOT NULL
    `).all() as Array<{ id: string; scope: string; embedding_json: string }>;
    for (const row of rows) {
      try {
        const emb = JSON.parse(row.embedding_json) as number[];
        upsertEmbedding(db, row.id, row.scope, emb);
      } catch {
        // skip malformed historical embeddings
      }
    }
  } catch {
    annStatus = { enabled: false, message: "ann_sync_failed" };
  }
}

export async function insertMemoryRows(rows: MemoryRecord[]): Promise<void> {
  if (rows.length === 0) return;
  const db = getDb();
  const insertRecord = db.prepare(`
    INSERT INTO memory_records
      (id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let insertFts: ReturnType<typeof db.prepare> | null = null;
  try {
    insertFts = db.prepare(`INSERT INTO memory_fts (id, content) VALUES (?, ?)`);
  } catch {
    insertFts = null;
  }
  try {
    db.exec("BEGIN");
    for (const r of rows) {
      insertRecord.run(
        r.id,
        r.parentId,
        r.chunkIndex,
        r.content,
        r.embedding ? JSON.stringify(r.embedding) : null,
        r.kind,
        r.scope,
        r.importance,
        r.tokenCount,
        r.recallCount,
        r.lastRecalledAt,
        r.validityScore,
        r.isNegative ? 1 : 0,
        r.createdAt,
        r.updatedAt,
      );
      upsertEmbedding(db, r.id, r.scope, r.embedding);
      if (insertFts) {
        try {
          (insertFts as { run: (...args: unknown[]) => unknown }).run(r.id, r.content);
        } catch {
          // optional
        }
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export async function loadAllMemories(scope?: MemoryScope): Promise<MemoryRecord[]> {
  const db = getDb();
  const rows = scope
    ? (db.prepare(`
        SELECT id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at
        FROM memory_records
        WHERE scope = ?
      `).all(scope) as StoredRow[])
    : (db.prepare(`
        SELECT id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at
        FROM memory_records
      `).all() as StoredRow[]);
  return rows.map(parseRow);
}

export async function countMemories(scope?: MemoryScope): Promise<number> {
  const db = getDb();
  const row = scope
    ? (db.prepare(`SELECT COUNT(*) AS c FROM memory_records WHERE scope = ?`).get(scope) as { c: number })
    : (db.prepare(`SELECT COUNT(*) AS c FROM memory_records`).get() as { c: number });
  return row.c;
}

export async function loadMemoriesByIds(ids: string[]): Promise<MemoryRecord[]> {
  if (ids.length === 0) return [];
  const db = getDb();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at
    FROM memory_records
    WHERE id IN (${placeholders})
  `).all(...ids) as StoredRow[];
  const mapped = new Map(rows.map((r) => [r.id, parseRow(r)]));
  return ids.map((id) => mapped.get(id)).filter((x): x is MemoryRecord => Boolean(x));
}

export async function listMemories(options?: MemoryListOptions): Promise<MemorySummary[]> {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (options?.scope) {
    where.push("scope = ?");
    params.push(options.scope);
  }
  if (options?.kind) {
    where.push("kind = ?");
    params.push(options.kind);
  }
  if (options?.query?.trim()) {
    where.push("content LIKE ?");
    params.push(`%${options.query.trim()}%`);
  }

  const limit = Math.max(1, Math.min(200, options?.limit ?? 30));
  const offset = Math.max(0, options?.offset ?? 0);
  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at
    FROM memory_records
    ${whereClause}
    ORDER BY updated_at DESC
    LIMIT ?
    OFFSET ?
  `).all(...params, limit, offset) as StoredRow[];

  return rows.map((row) => {
    const parsed = parseRow(row);
    const { embedding: _embedding, ...summary } = parsed;
    return summary;
  });
}

export async function countMemoriesByKind(options?: Pick<MemoryListOptions, "scope" | "query">): Promise<Record<MemoryKind, number>> {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (options?.scope) {
    where.push("scope = ?");
    params.push(options.scope);
  }
  if (options?.query?.trim()) {
    where.push("content LIKE ?");
    params.push(`%${options.query.trim()}%`);
  }

  const whereClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT kind, COUNT(*) AS count
    FROM memory_records
    ${whereClause}
    GROUP BY kind
  `).all(...params) as Array<{ kind: string; count: number }>;

  const counts = MEMORY_KINDS.reduce((acc, kind) => {
    acc[kind] = 0;
    return acc;
  }, {} as Record<MemoryKind, number>);

  for (const row of rows) {
    if (MEMORY_KINDS.includes(row.kind as MemoryKind)) {
      counts[row.kind as MemoryKind] = Number(row.count) || 0;
    }
  }
  return counts;
}

export async function getMemoryById(id: string): Promise<MemoryRecord | null> {
  const db = getDb();
  const row = db.prepare(`
    SELECT id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at
    FROM memory_records
    WHERE id = ?
    LIMIT 1
  `).get(id) as StoredRow | undefined;
  if (!row) return null;
  return parseRow(row);
}

export async function loadSiblingChunks(parentId: string, chunkIndex: number, window = 1): Promise<MemoryRecord[]> {
  const db = getDb();
  const min = Math.max(0, chunkIndex - window);
  const max = chunkIndex + window;
  const rows = db.prepare(`
    SELECT id, parent_id, chunk_index, content, embedding_json, kind, scope, importance, token_count, recall_count, last_recalled_at, validity_score, is_negative, created_at, updated_at
    FROM memory_records
    WHERE parent_id = ? AND chunk_index BETWEEN ? AND ?
    ORDER BY chunk_index ASC
  `).all(parentId, min, max) as StoredRow[];
  return rows.map(parseRow);
}

export async function searchVectorIds(
  queryEmbedding: number[],
  limit: number,
  scope?: MemoryScope,
): Promise<string[]> {
  const db = getDb();
  if (!annStatus.enabled) return [];
  try {
    const hits = searchNearest(db, queryEmbedding, limit, scope);
    return hits.map((hit) => hit.id);
  } catch {
    return [];
  }
}

export async function searchKindNeighbors(
  queryEmbedding: number[],
  limit = 20,
  scope?: MemoryScope,
): Promise<KindNeighbor[]> {
  const db = getDb();
  if (!annStatus.enabled) return [];
  try {
    const hits = searchNearest(db, queryEmbedding, limit, scope);
    if (hits.length === 0) return [];
    const candidates = await loadMemoriesByIds(hits.map((h) => h.id));
    const byId = new Map(candidates.map((c) => [c.id, c.kind]));
    const out: KindNeighbor[] = [];
    for (const hit of hits) {
      const kind = byId.get(hit.id);
      if (!kind) continue;
      const distance = Number(hit.distance);
      const score = Number.isFinite(distance) ? 1 / (1 + Math.max(0, distance)) : 0;
      out.push({ kind, score });
    }
    return out;
  } catch {
    return [];
  }
}

export async function searchFtsIds(query: string, limit = 40): Promise<Set<string>> {
  const trimmed = query.trim();
  if (!trimmed) return new Set();

  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT id FROM memory_fts
      WHERE memory_fts MATCH ?
      LIMIT ?
    `).all(trimmed, limit) as Array<{ id: string }>;
    const ids = new Set<string>(rows.map((r) => r.id));
    return ids;
  } catch {
    return new Set<string>();
  }
}

export async function findSemanticDuplicate(
  embedding: number[],
  scope: MemoryScope,
  threshold = 0.95,
): Promise<MemoryRecord | null> {
  if (!embedding.length) return null;
  const vectorIds = await searchVectorIds(embedding, DEDUP_CANDIDATE_LIMIT, scope);
  const candidates = await loadMemoriesByIds(vectorIds);
  let best: MemoryRecord | null = null;
  let bestScore = -1;
  for (const candidate of candidates) {
    if (!candidate.embedding) continue;
    const sim = cosine(embedding, candidate.embedding);
    if (sim > bestScore) {
      bestScore = sim;
      best = candidate;
    }
  }
  return bestScore >= threshold ? best : null;
}

export async function mergeIntoExistingMemory(
  existingId: string,
  incoming: Pick<MemoryRecord, "content" | "importance" | "updatedAt" | "embedding" | "tokenCount" | "kind">,
): Promise<void> {
  const db = getDb();
  db.prepare(`
    UPDATE memory_records
    SET
      content = ?,
      kind = ?,
      embedding_json = ?,
      importance = MIN(1.0, (importance * 0.9) + (? * 0.1)),
      token_count = ?,
      updated_at = ?,
      validity_score = MIN(1.0, validity_score + 0.01)
    WHERE id = ?
  `).run(
    incoming.content,
    incoming.kind,
    incoming.embedding ? JSON.stringify(incoming.embedding) : null,
    incoming.importance,
    incoming.tokenCount,
    incoming.updatedAt,
    existingId,
  );
  const row = db.prepare(`SELECT scope FROM memory_records WHERE id = ?`).get(existingId) as { scope: string } | undefined;
  upsertEmbedding(db, existingId, row?.scope ?? "global", incoming.embedding);
  try {
    db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(existingId);
    db.prepare(`INSERT INTO memory_fts (id, content) VALUES (?, ?)`).run(existingId, incoming.content);
  } catch {
    // optional
  }
}

export async function bumpRecallMetrics(ids: string[], recallBoost = 0.04): Promise<void> {
  if (ids.length === 0) return;
  const db = getDb();
  const now = Date.now();
  const stmt = db.prepare(`
    UPDATE memory_records
    SET
      recall_count = recall_count + 1,
      last_recalled_at = ?,
      updated_at = ?,
      importance = MIN(1.0, (importance * 0.98) + ?)
    WHERE id = ?
  `);
  const tx = db.transaction((memoryIds: string[]) => {
    for (const id of memoryIds) {
      stmt.run(now, now, recallBoost, id);
    }
  });
  tx(ids);
}

export async function getRagStorageStatus(): Promise<RagStorageStatus> {
  const corpusSize = await countMemories();
  return {
    path: getDbPath(),
    ann: annStatus,
    corpusSize,
  };
}

export async function initializeRagStorage(): Promise<void> {
  getDb();
}

export async function markMemoryInvalid(id: string, score = 0.2): Promise<void> {
  const db = getDb();
  db.prepare(`
    UPDATE memory_records
    SET validity_score = MAX(0, ?), is_negative = 1, updated_at = ?
    WHERE id = ?
  `).run(score, Date.now(), id);
}

export async function deleteMemory(id: string): Promise<void> {
  const db = getDb();
  db.prepare(`DELETE FROM memory_records WHERE id = ?`).run(id);
  deleteEmbedding(db, id);
  try {
    db.prepare(`DELETE FROM memory_fts WHERE id = ?`).run(id);
  } catch {
    // optional
  }
}
