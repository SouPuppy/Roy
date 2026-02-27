import { log } from "@/logger";

export function parseJsonOrString(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    log.warn({ raw: str }, "JSON parse failed, using raw string");
    return str;
  }
}
