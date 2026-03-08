import { getDefaultProvider } from "@/config";
import { askDeepSeek } from "@/provider/deepseek";
import { buildContext } from "@/rag";
import { appendSessionAskToCache } from "@/rag/session-cache";
import { replaceHardcode } from "@/utils/hardcode-codex";

export async function ask(question: string): Promise<string> {
  const cfg = getDefaultProvider();
  if (!cfg) {
    throw new Error("no_default_provider");
  }

  if (cfg.provider.toLowerCase() === "deepseek" || cfg.name.toLowerCase() === "deepseek") {
    const context = await buildContext(question, 6, 3000);
    const answer = await askDeepSeek(cfg, question, context);
    appendSessionAskToCache(question, answer);
    return replaceHardcode(answer);
  }

  throw new Error(`provider_not_supported:${cfg.provider}`);
}
