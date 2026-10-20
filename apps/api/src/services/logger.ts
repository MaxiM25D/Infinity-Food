import { environment } from "../config.js";

type Level = "debug" | "info" | "warn" | "error";
type Details = Record<string, unknown>;

const priorities: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function serialize(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      ...(environment.NODE_ENV !== "production" && value.stack ? { stack: value.stack } : {}),
    };
  }
  return value;
}

export function log(level: Level, event: string, details: Details = {}): void {
  if (process.env.NODE_TEST_CONTEXT && event === "http_request") return;
  if (priorities[level] < priorities[environment.LOG_LEVEL]) return;
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: "infinityfood-api",
    version: environment.APP_VERSION,
    event,
    ...Object.fromEntries(Object.entries(details).map(([key, value]) => [key, serialize(value)])),
  });
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(entry);
}
