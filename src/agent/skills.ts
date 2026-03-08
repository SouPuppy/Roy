import type { ToolDef, ToolResult } from "./toolbox";
import { exec as execBultin } from "@/bultins/exec";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const register = new Map<string, ToolDef>();

/** Register a tool. Call from skills.ts or when loading bultins. */
export function registerTool(def: ToolDef): void {
  register.set(def.name, def);
}

// Register bultin.exec
registerTool({
  name: "bultin.exec",
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
function runTool(name: string, args: Record<string, unknown>): ToolResult {
  const def = register.get(name);
  if (!def) {
    return { result_code: -1, stderr: `unknown_tool:${name}` };
  }
  return def.run(args);
}

/**
 * If entire response is valid JSON tool call: look up in skills register,
 * run, output result (0) or error code.
 */
export function parseAndRun(response: string): { text: string; result_code?: number } {
  const raw = response.trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { text: raw };
  }
  if (!isValidToolCall(parsed)) {
    return { text: raw };
  }
  const result = runTool(parsed.tool, parsed.arguments);
  const text = JSON.stringify({
    result_code: result.result_code,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return { text, result_code: result.result_code };
}
