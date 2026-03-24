import pino, { type Level } from "pino";
import path from "node:path";
import { mkdirSync } from "node:fs";
import { config } from "./config.js";

function parseLogLevel(v: string): Level {
  const x = v.toLowerCase();
  if (
    x === "trace" ||
    x === "debug" ||
    x === "info" ||
    x === "warn" ||
    x === "error" ||
    x === "fatal"
  ) {
    return x;
  }
  return "info";
}

const level = parseLogLevel(String(config.logLevel));

function createLogger(): pino.Logger {
  const targets: NonNullable<pino.TransportMultiOptions["targets"]>[number][] = [];

  if (config.logPretty) {
    targets.push({
      target: "pino-pretty",
      level,
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
        singleLine: false,
      },
    });
  } else {
    targets.push({
      target: "pino/file",
      level,
      options: { destination: 1 },
    });
  }

  if (config.logFile) {
    const dir = path.dirname(config.logFile);
    mkdirSync(dir, { recursive: true });
    targets.push({
      target: "pino/file",
      level,
      options: { destination: config.logFile, mkdir: true, append: true },
    });
  }

  if (targets.length === 1 && !config.logFile && !config.logPretty) {
    return pino({ level });
  }

  return pino({
    level,
    transport: { targets },
  });
}

export const logger = createLogger();
