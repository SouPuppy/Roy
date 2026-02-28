import { WebSocketServer } from "ws";
import { createSession } from "./session";
import { log } from "@/logger";
import { parseJsonOrString } from "@/utils/parse-json";
import { getHomeDir } from "@/home";

const PORT = 50000;

export function start(): void {
  const LOG_LEVEL = (process.env.LOG_LEVEL ?? "debug").toLowerCase();
  const homeDir = getHomeDir();
  log.info({ LOG_LEVEL, homeDir }, "Starting");

  const wss = new WebSocketServer({ port: PORT });

  wss.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      log.error({ port: PORT }, `Port ${PORT} is already in use. Stop the existing process: lsof -ti:${PORT} | xargs kill`);
      process.exit(1);
    }
    throw err;
  });

  wss.on("listening", () => {
    log.info({ port: PORT }, `WebSocket server on ws://localhost:${PORT}`);
  });

  wss.on("connection", (ws) => {
    const session = createSession(ws);
    log.info({}, `[${session.id}] Session connected`);

    const heartbeat = setInterval(() => {
      session.ws.send(JSON.stringify({ type: "heartbeat", timestamp: Date.now() }));
    }, 1000);

    ws.on("message", (data) => {
      const payload = parseJsonOrString(data.toString());
      log.debug({ data: payload }, `[${session.id}] Received`);
    });

    ws.on("close", () => {
      clearInterval(heartbeat);
      log.info({}, `[${session.id}] Session disconnected`);
    });
  });
}
