import pino from "pino";

const logLevel = process.env.LOG_LEVEL ?? "debug";
const isDev = process.stdout.isTTY;

export const log = pino({
  level: logLevel,
  ...(isDev && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true },
    },
  }),
});
