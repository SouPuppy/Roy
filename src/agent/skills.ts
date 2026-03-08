import type { ToolDef, ToolResult } from "./toolbox";
import { exec as execBultin } from "@/bultins/exec";
import { runMemory } from "@/bultins/memory";
import { think as thinkBultin } from "@/agent/think";
import { log } from "@/logger";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const register = new Map<string, ToolDef>();

/** Register a tool. Call from skills.ts or when loading bultins. */
export function registerTool(def: ToolDef): void {
  register.set(def.name, def);
}

// Register bultin_exec (API requires a-z, 0-9, underscore—no dots)
registerTool({
  name: "bultin_exec",
  prompt: readFileSync(join(__dirname, "../bultins/exec/SKILL.md"), "utf-8"),
  run: (args) => {
    const cmd = typeof args?.cmd === "string" ? args.cmd : "";
    const r = execBultin({ cmd });
    return {
      result_code: r.code,
      stdout: r.stdout,
      stderr: r.stderr,
    };
  },
});

registerTool({
  name: "bultin_think",
  prompt: "Call LLM for reasoning. Use when you need to reason through a problem before acting.",
  run: async (args) => {
    const q = typeof args?.question === "string" ? args.question : "";
    const out = await thinkBultin(q);
    return { result_code: 0, stdout: out };
  },
});

registerTool({
  name: "bultin_memory",
  prompt: readFileSync(join(__dirname, "../bultins/memory/SKILL.md"), "utf-8"),
  run: async (args) => {
    const action = typeof args?.action === "string" ? args.action : "";
    const r = await runMemory({
      action: action as "store" | "recall" | "summary" | "forget",
      content: typeof args?.content === "string" ? args.content : undefined,
      query: typeof args?.query === "string" ? args.query : undefined,
      id: typeof args?.id === "string" ? args.id : undefined,
      kind: typeof args?.kind === "string" ? args.kind : undefined,
      scope: typeof args?.scope === "string" ? args.scope : undefined,
      limit: typeof args?.limit === "number" ? args.limit : undefined,
    });
    return {
      result_code: r.result_code,
      stdout: r.data ? JSON.stringify(r.data) : undefined,
      stderr: r.stderr,
    };
  },
});

export type ToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
};

function isValidToolCall(obj: unknown): obj is ToolCall {
  if (!obj || typeof obj !== "object") return false;
  const o = obj as Record<string, unknown>;
  if (typeof o.tool !== "string" || !o.tool.trim()) return false;
  if (!o.arguments || typeof o.arguments !== "object") return false;
  return true;
}

/** Collect all skill prompts for LLM. Agent uses this to find needed skills. */
export function getSkillsPrompt(): string {
  const parts: string[] = [];
  for (const def of register.values()) {
    parts.push(`## ${def.name}\n${def.prompt}`);
  }
  return parts.join("\n\n---\n\n");
}

/** Look up tool by name in register, run, return result. */
export async function runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  const def = register.get(name);
  if (!def) {
    log.debug({ step: "[skills] runTool unknown", name });
    return { result_code: -1, stderr: `unknown_tool:${name}` };
  }
  log.debug({ step: "[skills] runTool", name, args });
  return def.run(args);
}

/**
 * If entire response is valid JSON tool call: look up in skills register,
 * run, output result (0) or error code.
 */
export async function parseAndRun(response: string): Promise<{ text: string; result_code?: number }> {
  const raw = response.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log.debug("[skills] parseAndRun: not JSON, pass-through");
    return { text: raw };
  }
  if (!isValidToolCall(parsed)) {
    log.debug("[skills] parseAndRun: invalid tool call, pass-through");
    return { text: raw };
  }
  log.debug({ step: "[skills] parseAndRun tool call", tool: parsed.tool });
  const result = await runTool(parsed.tool, parsed.arguments);
  const text = JSON.stringify({
    result_code: result.result_code,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return { text, result_code: result.result_code };
}
