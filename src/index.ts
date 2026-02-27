import { existsSync } from "fs";
import { config } from "dotenv";
import { resolve, dirname, join } from "path";

function findWorkDir(): string {
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(dir, ".home"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const workDir = findWorkDir();
const homeDir = join(workDir, ".home");
config({ path: join(homeDir, ".env") });

process.env.HOME_DIR = homeDir;
if (!process.env.LOG_LEVEL) process.env.LOG_LEVEL = "debug";

export { METADATA } from "@/meta";
await import("@/cli");
