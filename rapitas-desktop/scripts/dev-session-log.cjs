'use strict';
/**
 * dev-session-log
 *
 * Mirrors dev.js's own output and lifecycle into a file, so a supervisor that
 * disappears leaves a trace. dev.js logs to the terminal it was started from;
 * once that terminal is gone, so is the only record of why the dev server
 * stopped.
 *
 * NOT the backend's log. The backend writes `.data/logs/backend-<date>.log`
 * through pino and keeps doing so. This is the SUPERVISOR's log: child exits,
 * restarts, and dev.js's own death — the three things that were missing on
 * 2026-10-31, when the backend's exit-75 restart had nothing left to relaunch
 * it and no file said why.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Beside the backend's own log, so one directory holds the whole picture. */
const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', '.data', 'logs');

/** How often to record that the supervisor is still alive. */
const DEFAULT_HEARTBEAT_MS = 60_000;

/** Longest recorded message. dev.js can print a whole stack trace. */
const MAX_MSG_CHARS = 2_000;

// eslint-disable-next-line no-control-regex -- stripping ANSI needs the escape byte
const ANSI_PATTERN = /\u001b\[[0-9;]*[A-Za-z]/g;

/**
 * Flatten a logged value into one greppable line: no escape sequences, no
 * newlines, and bounded length.
 *
 * @param {unknown} value Whatever the caller passed to log.info/warn/error
 * @returns {string} A single-line, capped message
 */
function normalizeMessage(value) {
  const text = String(value)
    .replace(ANSI_PATTERN, '')
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
  return text.length > MAX_MSG_CHARS ? `${text.slice(0, MAX_MSG_CHARS)}…` : text;
}

/**
 * Build a session logger.
 *
 * @param {{ dir?: string, now?: () => Date }} [options] Overrides, for tests
 * @returns {{
 *   appendDevEvent: (event: string, fields?: object) => void,
 *   currentLogFile: () => string,
 *   wrapLogger: (logger: object) => void,
 *   startHeartbeat: (intervalMs?: number) => NodeJS.Timeout,
 * }} The session logger
 */
function createDevSessionLog(options = {}) {
  const dir = options.dir || DEFAULT_LOG_DIR;
  const clock = options.now || (() => new Date());

  /** One file per LOCAL day, matching backend-<date>.log's naming. */
  const currentLogFile = () => {
    const d = clock();
    const stamp = [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
    return path.join(dir, `dev-${stamp}.ndjson`);
  };

  /**
   * Append one event.
   *
   * NOTE: Never throws. This file exists to observe the dev server, and an
   * observer that can stop it is worse than no observer — a full disk or a
   * file lock must not become the outage.
   *
   * @param {string} event Event name (`dev_start`, `heartbeat`, `log`, …)
   * @param {object} [fields] Extra fields to record alongside it
   */
  const appendDevEvent = (event, fields = {}) => {
    try {
      fs.mkdirSync(dir, { recursive: true });
      const line = JSON.stringify({
        time: clock().toISOString(),
        pid: process.pid,
        event,
        ...fields,
      });
      fs.appendFileSync(currentLogFile(), `${line}\n`);
    } catch {
      // Deliberately silent: reporting this failure would need the very
      // channel that just failed, and dev.js still prints to its terminal.
    }
  };

  /**
   * Tee a logger's levels into the file. The original call still runs, so the
   * terminal output is unchanged — this is a tee, not a redirect.
   *
   * @param {{ info: Function, warn: Function, error: Function }} logger dev.js's `log`
   */
  const wrapLogger = (logger) => {
    for (const level of ['info', 'warn', 'error']) {
      const original = logger[level];
      if (typeof original !== 'function') continue;
      logger[level] = (msg) => {
        appendDevEvent('log', { level, msg: normalizeMessage(msg) });
        return original(msg);
      };
    }
  };

  /**
   * Start recording liveness.
   *
   * NOTE: A hard kill (taskkill /F, SIGKILL) runs no handler, so no exit event
   * can ever be written for it. A last heartbeat with no exit after it is the
   * only evidence that distinguishes "killed" from "stopped without logging".
   * The timer is unref()d so it cannot keep dev.js alive on its own.
   *
   * @param {number} [intervalMs] Heartbeat period
   * @returns {NodeJS.Timeout} The interval, for the caller to clear
   */
  const startHeartbeat = (intervalMs = DEFAULT_HEARTBEAT_MS) => {
    const timer = setInterval(() => {
      appendDevEvent('heartbeat', { uptimeSec: Math.round(process.uptime()) });
    }, intervalMs);
    timer.unref();
    return timer;
  };

  /**
   * Tee the console itself.
   *
   * NOTE: This, not `wrapLogger`, is what dev.js installs. The file's own
   * header says most of it still calls `console.log` directly and only the
   * newer PID/health logging goes through `log` — so hooking `log` would miss
   * the majority of the output, including the startup narrative that says how
   * far a failed start got. Hooking the console catches `log.*` too, since
   * those delegate to it; installing both would double-record.
   *
   * Multiple arguments are joined the way the console prints them.
   *
   * @param {Console} target The console to tee (injectable for tests)
   */
  const wrapConsole = (target) => {
    const levels = [
      ['log', 'info'],
      ['warn', 'warn'],
      ['error', 'error'],
    ];
    for (const [method, level] of levels) {
      const original = target[method];
      if (typeof original !== 'function') continue;
      target[method] = (...args) => {
        appendDevEvent('console', { level, msg: normalizeMessage(args.join(' ')) });
        return original.apply(target, args);
      };
    }
  };

  return { appendDevEvent, currentLogFile, wrapLogger, wrapConsole, startHeartbeat };
}

module.exports = { createDevSessionLog, normalizeMessage, DEFAULT_LOG_DIR, MAX_MSG_CHARS };
