import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "@iarna/toml";
import { getHomeDir } from "@/home";

export type ProviderConfig = {
  name: string;
  provider: string;
  api_key: string;
  input?: string;
  max_tokens?: number;
};

type AppConfig = {
  log_level?: string;
  agent?: {
    root?: {
      provider?: string;
    };
  };
  provider?: {
    default?: {
      name?: string;
      provider?: string;
      mode_provider?: string;
      api_key?: string;
      input?: string;
      max_tokens?: number;
    };
  };
  providers?: ProviderConfig[];
};

let _config: AppConfig | null = null;

function loadConfig(): AppConfig {
  if (_config) return _config;
  const configPath = join(getHomeDir(), "config.toml");
  if (!existsSync(configPath)) {
    _config = {};
    return _config;
  }
  _config = parse(readFileSync(configPath, "utf-8")) as AppConfig;
  return _config;
}

function normalizeApiKey(raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  // Historical template value; treat as not configured.
  if (v === "sk-") return "";
  return v;
}

export function getLogLevel(): string {
  const cfg = loadConfig();
  return (cfg.log_level ?? process.env.LOG_LEVEL ?? "debug").toLowerCase();
}

export function getActiveProvider(): ProviderConfig | null {
  const cfg = loadConfig();
  const defaultProvider = cfg.provider?.default;
  if (defaultProvider) {
    const providerName = (defaultProvider.provider ?? defaultProvider.mode_provider ?? defaultProvider.name ?? "unknown").toLowerCase();
    const envApiKey = providerName === "deepseek"
      ? (process.env.DEEPSEEK_API_KEY ?? process.env.OPENAI_API_KEY)
      : process.env.OPENAI_API_KEY;
    const apiKey = normalizeApiKey(defaultProvider.api_key) || normalizeApiKey(envApiKey);
    return {
      name: defaultProvider.name ?? "default",
      provider: defaultProvider.provider ?? defaultProvider.mode_provider ?? defaultProvider.name ?? "unknown",
      api_key: apiKey,
      input: defaultProvider.input,
      max_tokens: defaultProvider.max_tokens,
    };
  }

  const providers = cfg.providers ?? [];
  if (providers.length === 0) return null;

  const rootProviderName = cfg.agent?.root?.provider;
  if (!rootProviderName) return providers[0] ?? null;

  return providers.find((p) => p.name === rootProviderName) ?? null;
}

export function getDefaultProvider(): ProviderConfig | null {
  return getActiveProvider();
}
