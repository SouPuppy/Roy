import { getDefaultProvider } from "@/config";
import { askDeepSeek } from "@/provider/deepseek";
import { replaceHardcode } from "@/utils/hardcode-codex";
import { log } from "@/logger";

/**
 * Call default LLM with a question, get a plain language answer.
 * No RAG, no skills—just raw LLM. Like exec but at LLM level.
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
