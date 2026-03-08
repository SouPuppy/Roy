import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getHomeDir } from "@/home";

const CACHE_DIR = "memory/cache";

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
