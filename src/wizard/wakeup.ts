import { existsSync, mkdirSync, cpSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import * as p from "@clack/prompts";
import Database from "better-sqlite3";
import { log } from "@/logger";
import { hardcodeExists, readHardcode, writeHardcode } from "@/meta/hardcode";
import { hasWorkspaceDirConfigured, getWorkspaceDir, writeWorkspaceDir } from "@/config";
import { getHomeDir, setHomeDir } from "@/home";
import { ensureEmbeddingModel } from "@/rag/embedding";
import { initializeRagStorage } from "@/rag/db";
import { remember } from "@/rag";
import { replaceHardcode } from "@/utils/hardcode-codex";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(__dirname, "../template/home");
const WAKEUP_PATH = resolve(__dirname, "../template/WAKEUP");

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
  const memoryDir = join(homeDir, "memory");
  const cacheDir = join(memoryDir, "cache");
  mkdirSync(memoryDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });

  const dbPath = join(memoryDir, "memory.db");
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

  let name: string;
  let serialSuffix: string;
  let user: string;
  const isFirstWakeup = !hardcodeExists();
  if (isFirstWakeup) {
    const nameRes = await p.text({
      message: "Name",
      initialValue: "Roy",
      placeholder: "Roy",
      validate: (v) => {
        if (!v?.trim()) return "Name is required";
        return undefined;
      },
    });
    if (p.isCancel(nameRes)) {
      p.cancel("Operation cancelled.");
      process.exit(1);
    }
    name = nameRes.trim();

    const randomSuffix = String(Math.floor(10000 + Math.random() * 90000));
    const suffixRes = await p.text({
      message: "Serial suffix (5 digits, Enter to use random)",
      initialValue: randomSuffix,
      placeholder: randomSuffix,
      validate: (v) => {
        const s = (v ?? "").trim();
        if (!s) return undefined;
        if (!/^\d{5}$/.test(s)) return "Must be exactly 5 digits";
        return undefined;
      },
    });
    if (p.isCancel(suffixRes)) {
      p.cancel("Operation cancelled.");
      process.exit(1);
    }
    serialSuffix = (suffixRes.trim() || randomSuffix).padStart(5, "0").slice(-5);

    const userRes = await p.text({
      message: "Creator name (call me)",
      initialValue: "User",
      placeholder: "User",
    });
    if (p.isCancel(userRes)) {
      p.cancel("Operation cancelled.");
      process.exit(1);
    }
    user = (userRes?.trim() || "User");

    writeHardcode({ NAME: name, SERIAL_SUFFIX: serialSuffix, USER: user });
  } else {
    const hc = readHardcode();
    name = hc.NAME;
    serialSuffix = hc.SERIAL_SUFFIX;
    user = hc.USER ?? "User";
  }

  if (!hasWorkspaceDirConfigured()) {
    const workspaceRes = await p.text({
      message: "Workspace dir (for exec, file ops)",
      initialValue: ".workspace",
      placeholder: ".workspace",
      validate: (v) => {
        if (!v?.trim()) return "Workspace dir is required";
        return undefined;
      },
    });
    if (p.isCancel(workspaceRes)) {
      p.cancel("Operation cancelled.");
      process.exit(1);
    }
    const raw = workspaceRes.trim();
    const workDir = dirname(getHomeDir());
    const resolved = raw === ".workspace" ? join(workDir, ".workspace") : raw;
    mkdirSync(resolved, { recursive: true });
    writeWorkspaceDir(resolved);
  }

  const workspaceDir = getWorkspaceDir();
  mkdirSync(workspaceDir, { recursive: true });

  if (isFirstWakeup) {
    const wakeupSpinner = p.spinner();
    wakeupSpinner.start("Injecting WAKEUP into memory...");
    const rawWakeup = readFileSync(WAKEUP_PATH, "utf-8");
    const wakeupContent = replaceHardcode(rawWakeup);
    await remember(wakeupContent, { kind: "identity", scope: "global", importance: 0.9 });
    wakeupSpinner.stop("WAKEUP injected");
  }

  p.outro(`Initialized`);
  process.stdout.write(`\nHi, I'm ${name}.\n\n`);
}
