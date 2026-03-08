import { randomUUID } from "crypto";
import { appendFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import { getHomeDir } from "@/home";

function getSessionDir(): string {
  const dir = join(getHomeDir(), "memory", "session");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function createSession(): string {
  const id = randomUUID();
  const path = join(getSessionDir(), `${id}.md`);
  appendFileSync(path, `# Session ${id}\n\n`, "utf-8");
  return id;
}

export function getSessionPath(sessionId: string): string {
  return join(getSessionDir(), `${sessionId}.md`);
}

export function appendToSession(sessionId: string, i: number, input: string, output: string): void {
  const path = getSessionPath(sessionId);
  const block = `
In[${i}]:= ${input}

Out[${i}]= ${output}
`;
  appendFileSync(path, block, "utf-8");
}
