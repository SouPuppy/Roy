import type Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

export const EMBEDDING_DIM = 384;

export type AnnStatus = {
  enabled: boolean;
  message: string;
};

export type AnnMatch = {
  id: string;
  distance: number;
};

export function initializeAnn(db: Database.Database): AnnStatus {
  try {
    sqliteVec.load(db);
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_vec USING vec0(
        id TEXT PRIMARY KEY,
        embedding FLOAT[${EMBEDDING_DIM}],
        scope TEXT
      );
    `);
    return { enabled: true, message: "sqlite_vec_loaded" };
  } catch (error) {
    return {
      enabled: false,
      message: error instanceof Error ? error.message : "sqlite_vec_unavailable",
    };
  }
}

export function upsertEmbedding(
  db: Database.Database,
  id: string,
  scope: string,
  embedding: number[] | null,
): void {
  if (!embedding || embedding.length !== EMBEDDING_DIM) return;
  db.prepare(`DELETE FROM memory_vec WHERE id = ?`).run(id);
  db.prepare(`
    INSERT INTO memory_vec (id, embedding, scope)
    VALUES (?, ?, ?)
  `).run(id, JSON.stringify(embedding), scope);
}

export function deleteEmbedding(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM memory_vec WHERE id = ?`).run(id);
}

export function searchNearest(
  db: Database.Database,
  queryEmbedding: number[],
  limit: number,
  scope?: string,
): AnnMatch[] {
  if (queryEmbedding.length !== EMBEDDING_DIM || limit <= 0) return [];
  const query = JSON.stringify(queryEmbedding);
  if (scope) {
    return db.prepare(`
      SELECT id, distance
      FROM memory_vec
      WHERE embedding MATCH ? AND k = ? AND scope = ?
    `).all(query, limit, scope) as AnnMatch[];
  }
  return db.prepare(`
    SELECT id, distance
    FROM memory_vec
    WHERE embedding MATCH ? AND k = ?
  `).all(query, limit) as AnnMatch[];
}
