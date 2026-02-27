import { createHash, randomBytes } from "crypto";
import type { WebSocket } from "ws";
import { log } from "@/logger";
import { parseJsonOrString } from "@/utils/parse-json";

export type Session = {
  id: string;
  ws: WebSocket;
  createdAt: Date;
};

export function createSessionId(): string {
  const hash = createHash("sha256")
    .update(Date.now().toString() + randomBytes(8).toString("hex"))
    .digest("hex");
  return hash.slice(0, 7);
}

export function createSession(ws: WebSocket): Session {
  const sessionId = createSessionId();
  const originalSend = ws.send.bind(ws);
  const sendWrapper = (
    data: Parameters<WebSocket["send"]>[0],
    ...args: unknown[]
  ): void => {
    const dataStr = typeof data === "string" ? data : data.toString();
    const payload = parseJsonOrString(dataStr);
    log.debug({ data: payload }, `[${sessionId}] Sent`);
    (originalSend as (...a: unknown[]) => void)(data, ...args);
  };
  ws.send = sendWrapper as WebSocket["send"];

  return {
    id: sessionId,
    ws,
    createdAt: new Date(),
  };
}
