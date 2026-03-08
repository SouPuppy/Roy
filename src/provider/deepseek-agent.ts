/**
 * OpenClaw-style agent loop: model inference → tool execution → iterate until final reply.
 */
import type { ProviderConfig } from "@/config";
import { runTool } from "@/agent/skills";
import { log } from "@/logger";

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
  | { role: "tool"; tool_call_id: string; content: string };

const TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "bultin_think",
      description: "Call LLM for reasoning. Use when you need to reason through a problem before acting.",
      parameters: {
        type: "object",
        properties: { question: { type: "string", description: "Question or prompt for reasoning" } },
        required: ["question"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bultin_exec",
      description: "Run a shell command in workspace_dir. Use when user asks to create files, run commands, list dirs, etc.",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string", description: "Shell command" } },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "bultin_memory",
      description: "Store, recall, summarize, or forget memories. Use when user asks to remember, recall, search memory, or forget.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["store", "recall", "summary", "forget"] },
          content: { type: "string" },
          query: { type: "string" },
          id: { type: "string" },
          kind: { type: "string" },
          scope: { type: "string" },
          limit: { type: "number" },
        },
        required: ["action"],
      },
    },
  },
];

async function callModel(
  cfg: ProviderConfig,
  messages: ChatMessage[],
): Promise<{ content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }> {
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.api_key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-chat",
      messages,
      tools: TOOLS,
      tool_choice: "auto",
      max_tokens: cfg.max_tokens ?? 1024,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    if (res.status === 401) throw new Error("deepseek_invalid_api_key");
    throw new Error(`deepseek_http_${res.status}: ${errBody.slice(0, 200)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
  };
  const msg = data.choices?.[0]?.message;
  if (!msg) throw new Error("empty_response");
  return {
    content: msg.content?.trim(),
    tool_calls: msg.tool_calls,
  };
}

export async function runAgentLoop(
  cfg: ProviderConfig,
  systemPrompt: string,
  userMessage: string,
  maxRounds = 5,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userMessage },
  ];

  for (let round = 0; round < maxRounds; round++) {
    log.debug({ step: "[agent] callModel", round });
    const { content, tool_calls } = await callModel(cfg, messages);

    const assistantMsg: ChatMessage = {
      role: "assistant",
      content: content ?? "",
      tool_calls,
    };
    messages.push(assistantMsg);

    if (!tool_calls?.length) {
      const text = (content ?? "").trim();
      if (!text) throw new Error("empty_response");
      return text;
    }

    for (const tc of tool_calls) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
      } catch {
        args = {};
      }
      log.debug({ step: "[agent] runTool", name: tc.function.name });
      const result = await runTool(tc.function.name, args);
      const resultText = JSON.stringify({
        result_code: result.result_code,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      messages.push({ role: "tool", tool_call_id: tc.id, content: resultText });
    }
  }

  const last = messages[messages.length - 1] as { content?: string };
  return (last.content ?? "").trim() || "Max tool rounds reached.";
}
