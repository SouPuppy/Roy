import { getDefaultProvider } from "@/config";
import { askDeepSeek } from "@/provider/deepseek";

export async function ask(question: string): Promise<string> {
  const cfg = getDefaultProvider();
  if (!cfg) {
    throw new Error("no_default_provider");
  }

  if (cfg.provider.toLowerCase() === "deepseek" || cfg.name.toLowerCase() === "deepseek") {
    return askDeepSeek(cfg, question);
  }

  throw new Error(`provider_not_supported:${cfg.provider}`);
}
