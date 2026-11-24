/**
 * runtime-smoke/runtime-env-cause
 *
 * Decides, from a failed launch's log, whether the launch was stopped by an
 * ENVIRONMENT conflict (a taken port or a held lock) rather than by the code
 * under test. Pure. It is deliberately conservative: classifying an
 * implementation error as environmental lets broken code pass verification, so
 * every doubt resolves to null (= an ordinary implementation failure).
 */
import type { RuntimeEnvCause } from './runtime-server-registry-types';

/** Output that shows the server became ready; a failure after it is not a launch conflict. */
const READY_RE = /\b(?:listening|ready|started server)\b|Local:/i;
const PORT_RE =
  /EADDRINUSE|address already in use|\bport\b[^\n]*\b(?:is\s+)?(?:already\s+)?in use\b|ポート[^\n]*使用中/i;
const LOCK_RE =
  /\bis locked\b|already running|既に起動して|EBUSY|\bheld by\b|another instance|Unable to acquire lock/i;
const FATAL_START_RE =
  /^\s*(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|FATAL|EADDRINUSE|Unable to acquire lock)\b/;
const FRAME_RE = /^\s+at\s/;

/**
 * Classify a failed launch.
 *
 * @param input.text - Captured launch output / 起動ログ全文
 * @param input.reachedReady - Whether the launch ever met its readiness condition / 準備完了に到達したか
 * @returns `port_in_use` or `lock_held` only when the launch never became ready and the LAST
 *   fatal message is that conflict; null in every other case, including ambiguity / 原因またはnull
 */
export function classifyEnvCause(input: {
  text: string;
  reachedReady: boolean;
}): RuntimeEnvCause | null {
  const { text, reachedReady } = input;
  if (reachedReady || READY_RE.test(text)) return null;
  if (PORT_RE.test(text) && LOCK_RE.test(text)) return null;

  // Stack frames continue the error line above them, so they never start a new message.
  let lastFatal: string | null = null;
  for (const line of text.split('\n')) {
    if (FRAME_RE.test(line)) {
      lastFatal ??= line;
    } else if (
      FATAL_START_RE.test(line) ||
      /uncaught|unhandled/i.test(line) ||
      PORT_RE.test(line) ||
      LOCK_RE.test(line)
    ) {
      lastFatal = line;
    }
  }
  if (lastFatal === null) return null;
  if (PORT_RE.test(lastFatal)) return 'port_in_use';
  if (LOCK_RE.test(lastFatal)) return 'lock_held';
  return null;
}
