import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parse, stringify } from "@iarna/toml";
import { getHomeDir } from "@/home";

const HARDCODE_FILENAME = "HARDCODE";
const DEFAULT_NAME = "Roy";

export type HardcodeData = {
  NAME: string;
  SERIAL_SUFFIX: string;
};

type HardcodeToml = {
  __NAME__?: string;
  __SERIAL_SUFFIX__?: string;
};

function getHardcodePath(): string {
  return join(getHomeDir(), HARDCODE_FILENAME);
}

export function readHardcode(): HardcodeData {
  const path = getHardcodePath();
  if (!existsSync(path)) {
    return { NAME: DEFAULT_NAME, SERIAL_SUFFIX: "00000" };
  }
  try {
    const content = readFileSync(path, "utf-8");
    const parsed = parse(content) as HardcodeToml;
    const name = parsed.__NAME__?.trim();
    const suffix = parsed.__SERIAL_SUFFIX__?.trim();
    const validSuffix = /^\d{5}$/.test(suffix ?? "") ? suffix! : "00000";
    return {
      NAME: name || DEFAULT_NAME,
      SERIAL_SUFFIX: validSuffix,
    };
  } catch {
    return { NAME: DEFAULT_NAME, SERIAL_SUFFIX: "00000" };
  }
}

export function writeHardcode(data: HardcodeData): void {
  const path = getHardcodePath();
  const obj = { __NAME__: data.NAME, __SERIAL_SUFFIX__: data.SERIAL_SUFFIX };
  const content = stringify(obj);
  writeFileSync(path, content, "utf-8");
}

export function hardcodeExists(): boolean {
  return existsSync(getHardcodePath());
}
