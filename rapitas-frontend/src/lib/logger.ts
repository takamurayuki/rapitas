type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const current: LogLevel =
  (process.env.NEXT_PUBLIC_LOG_LEVEL as LogLevel) ??
  (process.env.NODE_ENV === "production" ? "warn" : "debug");

export function createLogger(name: string) {
  const p = `[${name}]`;
  const ok = (l: LogLevel) => LEVELS[l] >= LEVELS[current];
  return {
    debug: (...a: unknown[]) => ok("debug") && console.debug(p, ...a),
    info: (...a: unknown[]) => ok("info") && console.info(p, ...a),
    warn: (...a: unknown[]) => ok("warn") && console.warn(p, ...a),
    error: (...a: unknown[]) => ok("error") && console.error(p, ...a),
  };
}
