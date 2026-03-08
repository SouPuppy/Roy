import { existsSync, readFileSync, writeFileSync } from "fs";
import { join, resolve, dirname } from "path";
import { parse, stringify } from "@iarna/toml";
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
  workspace?: {
    dir?: string;
  };
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

export function hasWorkspaceDirConfigured(): boolean {
  const cfg = loadConfig();
  return (cfg.workspace?.dir?.trim()?.length ?? 0) > 0;
}

function findWorkDir(): string {
  let d = process.cwd();
  for (let i = 0; i < 20; i++) {
    if (existsSync(resolve(d, ".agent"))) return d;
    const parent = dirname(d);
    if (parent === d) break;
    d = parent;
  }
  return process.cwd();
}

export function getWorkspaceDir(): string {
  const cfg = loadConfig();
  const dir = cfg.workspace?.dir?.trim();
  if (dir) return dir;
  return join(findWorkDir(), ".workspace");
}

export function writeWorkspaceDir(dir: string): void {
  const configPath = join(getHomeDir(), "config.toml");
  const cfg = existsSync(configPath)
    ? (parse(readFileSync(configPath, "utf-8")) as AppConfig)
    : ({} as AppConfig);
  if (!cfg.workspace) cfg.workspace = {};
  cfg.workspace.dir = dir.trim();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  writeFileSync(configPath, stringify(cfg as any), "utf-8");
  _config = null;
}
