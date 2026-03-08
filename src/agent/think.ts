import { getDefaultProvider } from "@/config";
import { askDeepSeek } from "@/provider/deepseek";
import { replaceHardcode } from "@/utils/hardcode-codex";
import { log } from "@/logger";

/**
 * Simple ask: direct LLM call. No RAG, no skills, no tools.
 * Built-in fallback for quick questions.
 */
export async function think(question: string): Promise<string> {
  log.debug("[think] start");
  const cfg = getDefaultProvider();
  if (!cfg) {
    throw new Error("no_default_provider");
  }

  if (cfg.provider.toLowerCase() === "deepseek" || cfg.name.toLowerCase() === "deepseek") {
    log.debug("[think] askDeepSeek");
    const answer = await askDeepSeek(cfg, question.trim());
    log.debug("[think] replaceHardcode");
    return replaceHardcode(answer);
  }

  throw new Error(`provider_not_supported:${cfg.provider}`);
}
