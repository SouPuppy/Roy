import { existsSync } from "fs";
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

let _homeDir: string | null = null;

export function getHomeDir(): string {
  if (!_homeDir) {
    _homeDir = join(findWorkDir(), ".home");
  }
  return _homeDir;
}

export function setHomeDir(dir: string): void {
  _homeDir = dir;
}
