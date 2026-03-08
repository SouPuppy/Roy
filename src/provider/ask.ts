import { getDefaultProvider } from "@/config";
import { runAgentLoop } from "@/provider/deepseek-agent";
import { buildContext } from "@/rag";
import { appendSessionAskToCache } from "@/rag/session-cache";
import { replaceHardcode } from "@/utils/hardcode-codex";
import { log } from "@/logger";

const AGENT_SYSTEM_PROMPT = `You are Roy. Respond as Roy in first person. Use the memory context when relevant.

You have tools: bultin_think (reason through problems), bultin_exec (run shell commands), bultin_memory (store/recall/summary/forget).
Use them ONLY when the user explicitly asks you to DO something: create files, run commands, remember X, recall/search memory, forget.
For greetings and simple conversation—respond naturally as Roy. Do not call tools for "Hi" or casual chat.`;

export async function ask(question: string): Promise<string> {
  log.debug("[ask] start");
  const cfg = getDefaultProvider();
  if (!cfg) {
    throw new Error("no_default_provider");
  }

  if (cfg.provider.toLowerCase() === "deepseek" || cfg.name.toLowerCase() === "deepseek") {
    log.debug("[ask] buildContext");
    const context = await buildContext(question, 6, 3000);
    const systemPrompt = context
      ? `${AGENT_SYSTEM_PROMPT}\n\nMemory Context:\n${context}`
      : AGENT_SYSTEM_PROMPT;

    log.debug("[ask] runAgentLoop");
    const answer = await runAgentLoop(cfg, systemPrompt, question);

    log.debug("[ask] appendSessionAskToCache");
    appendSessionAskToCache(question, answer);
    log.debug("[ask] replaceHardcode");
    return replaceHardcode(answer);
  }

  throw new Error(`provider_not_supported:${cfg.provider}`);
}
