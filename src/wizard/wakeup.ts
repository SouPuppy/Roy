import { existsSync, mkdirSync, cpSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as p from "@clack/prompts";
import Database from "better-sqlite3";
import { log } from "@/logger";
import { METADATA } from "@/meta";
import { getHomeDir, setHomeDir } from "@/home";
import { ensureEmbeddingModel } from "@/rag/embedding";
import { initializeRagStorage } from "@/rag/db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../template/home");

async function initialize_home(): Promise<boolean> {
  const defaultHome = getHomeDir();

  if (existsSync(defaultHome)) {
    p.note(defaultHome, "Home dir already exists");
    return true;
  }

  const homeDir = await p.text({
    message: "Home dir",
    initialValue: defaultHome,
    placeholder: defaultHome,
    validate: (v) => {
      if (!v?.trim()) return "Home dir is required";
      return undefined;
    },
  });

  if (p.isCancel(homeDir)) {
    p.cancel("Operation cancelled.");
    process.exit(1);
  }

  const targetHome = homeDir.trim();
  if (existsSync(targetHome)) {
    p.note(targetHome, "Home dir already exists");
    setHomeDir(targetHome);
    return true;
  }

  const spinner = p.spinner();
  spinner.start("Initializing Home dir...");
  mkdirSync(targetHome, { recursive: true });
  mkdirSync(join(targetHome, "vault"), { recursive: true });
  mkdirSync(join(targetHome, "vault", "providers"), { recursive: true });
  mkdirSync(join(targetHome, "toolbox"), { recursive: true });

  cpSync(TEMPLATE_DIR, targetHome, { recursive: true });
  setHomeDir(targetHome);

  spinner.stop(`Home dir initialized at ${targetHome}`);
  return true;
}

async function initialize_database(): Promise<void> {
  const homeDir = getHomeDir();
  const dbPath = join(homeDir, "memory.db");
  const db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      built_in INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      code TEXT
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      content TEXT NOT NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS skills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      name TEXT NOT NULL,
      content TEXT NOT NULL
    )
  `);

  db.close();
  await initializeRagStorage();
  log.debug({ dbPath }, "Database initialized");
}

export async function wakeup(): Promise<void> {
  p.intro("Waking up Roy...");

  const ok = await initialize_home();
  if (!ok) process.exit(1);

  await initialize_database();

  const modelSpinner = p.spinner();
  modelSpinner.start("Downloading embedding model...");
  await ensureEmbeddingModel();
  modelSpinner.stop("Embedding model ready");

  p.outro(`Initialized`);
  process.stdout.write(`\nHi, I'm ${METADATA.NAME}.\n\n`);
}
