import { appendFileSync, mkdirSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { getHomeDir } from "@/home";

const CACHE_DIR = "memory/cache";

function getCacheDir(): string {
  return join(getHomeDir(), CACHE_DIR);
}

function getCacheFilePath(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;
  return join(getHomeDir(), CACHE_DIR, `${dateStr}.md`);
}

function ensureCacheDir(): void {
  const dir = join(getHomeDir(), CACHE_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Append session ask (question + answer) to memory/cache/YYYY-MM-DD.md.
 * Does NOT write to the database.
 */
export function appendSessionAskToCache(question: string, answer: string): void {
  ensureCacheDir();
  const filePath = getCacheFilePath();
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const block = `## ${timeStr}

**User:** ${question}

**Assistant:** ${answer}

`;
  appendFileSync(filePath, block, "utf-8");
}

/**
 * Get recent conversation blocks from cache (last 3 days).
 * Returns blocks in reverse chronological order (newest first), no keyword search.
 */
export function searchCache(options?: { days?: number; maxChars?: number }): string {
  const days = options?.days ?? 3;
  const maxChars = options?.maxChars ?? 1200;
  const cacheDir = getCacheDir();
  if (!existsSync(cacheDir)) return "";

  const blocks: string[] = [];
  const now = new Date();

  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const filePath = join(cacheDir, `${dateStr}.md`);
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, "utf-8");
      const rawBlocks = content.split(/(?=^##\s)/m).filter((b) => b.trim());
      for (const raw of rawBlocks) {
        blocks.push(raw.trim());
      }
    } catch {
      // skip unreadable
    }
  }

  blocks.reverse();

  let total = 0;
  const out: string[] = [];
  for (const block of blocks) {
    if (total + block.length > maxChars) break;
    out.push(`[cache] ${block}`);
    total += block.length;
  }
  return out.length === 0 ? "" : "Recent conversation (cache):\n" + out.join("\n\n");
}
