import { readHardcodeMap } from "@/meta/hardcode";

const PLACEHOLDER_RE = /__(.+?)__/g;

/**
 * Replace __PLACEHOLDER__ in text with values from .home/HARDCODE.
 * Builds a dynamic lookup table from the TOML file.
 * If a placeholder is not found, leave it unchanged (no replace).
 */
export function replaceHardcode(text: string): string {
  const map = readHardcodeMap();
  return text.replace(PLACEHOLDER_RE, (match) => map[match] ?? match);
}
