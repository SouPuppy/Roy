import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { parse } from "@iarna/toml";
import { getHomeDir } from "@/home";

let _config: { log_level?: string } | null = null;

function loadConfig(): { log_level?: string } {
  if (_config) return _config;
  const configPath = join(getHomeDir(), "config.toml");
  if (!existsSync(configPath)) {
    _config = {};
    return _config;
  }
  _config = parse(readFileSync(configPath, "utf-8")) as { log_level?: string };
  return _config;
}

export function getLogLevel(): string {
  const cfg = loadConfig();
  return (cfg.log_level ?? process.env.LOG_LEVEL ?? "debug").toLowerCase();
}
