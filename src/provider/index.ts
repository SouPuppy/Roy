import { getActiveProvider } from "@/config";
import { getDeepSeekStatus } from "@/provider/deepseek";
import type { LlmStatus } from "@/provider/types";

export async function getLlmStatus(): Promise<LlmStatus> {
  const cfg = getActiveProvider();
  if (!cfg) {
    return {
      provider: "unknown",
      ok: false,
      message: "no_provider_configured",
    };
  }

  if (cfg.provider.toLowerCase() === "deepseek" || cfg.name.toLowerCase() === "deepseek") {
    return getDeepSeekStatus(cfg);
  }

  return {
    provider: cfg.name,
    ok: false,
    message: "provider_not_supported_yet",
  };
}
