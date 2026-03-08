import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getHomeDir } from "@/home";

const SESSION_DIR = "session";

function getSessionDir(): string {
  const dir = join(getHomeDir(), SESSION_DIR);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getSessionFilePath(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const h = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  return join(getSessionDir(), `${y}-${m}-${d}-${h}${min}.md`);
}

let _sessionPath: string | null = null;

export function getSessionPath(): string {
  if (!_sessionPath) {
    _sessionPath = getSessionFilePath();
  }
  return _sessionPath;
}

export function appendToSession(i: number, input: string, output: string): void {
  const path = getSessionPath();
  const block = `
In[${i}]:= ${input}

Out[${i}]= ${output}
`;
  appendFileSync(path, block, "utf-8");
}
