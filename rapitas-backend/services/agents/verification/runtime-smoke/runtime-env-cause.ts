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
/** Phrases that mention readiness without claiming it ("not ready", "waiting ... to be ready"). */
const NOT_READY_RE =
  /(?:\b(?:not|never|until)|n't|\bto (?:be|become))\s+(?:(?:became|become|becoming|been)\s+)?ready/gi;
const READY_RE = /\b(?:listening|ready|started server)\b|Local:/i;
const PORT_RE =
  /EADDRINUSE|address already in use|\bport\b[^\n]*\b(?:is\s+)?(?:already\s+)?in use\b|ポート[^\n]*使用中/i;
const LOCK_RE =
  /\bis locked\b|already running|既に起動して|EBUSY[^\n]*[\\/.]lock\b|[\\/.]lock\b[^\n]*EBUSY|\bheld by\b|another instance|Unable to acquire lock/i;
const STANDALONE_LOCK_REFUSAL = '別のインスタンスが既に起動しています';
const LOCK_PARSE_FAILURE_RE = /^\s*Failed to parse (?:the )?lock file\b/i;
const FATAL_START_RE =
  /^\s*(?:Error|TypeError|ReferenceError|SyntaxError|RangeError|Unhandled|FATAL|EADDRINUSE|Unable to acquire lock)\b/;
const FRAME_RE = /^\s+at\s/;
const EXIT_CODE_RE = /\bexit code\s*[:=]?\s*(-?\d+)\b/i;

/**
 * Classify a failed launch.
 *
 * @param input.text - Captured launch output / 起動ログ全文
 * @param input.reachedReady - Whether the launch ever met its readiness condition / 準備完了に到達したか
 * @param input.exitedBeforeReady - 準備完了前かつ停止処理前に起動プロセスが終了したか
 * @returns `port_in_use` or `lock_held` only when the launch never became ready and the LAST
 *   fatal message is that conflict; null in every other case, including ambiguity / 原因またはnull
 */
export function classifyEnvCause(input: {
  text: string;
  reachedReady: boolean;
  exitedBeforeReady?: boolean;
}): RuntimeEnvCause | null {
  const { text, reachedReady, exitedBeforeReady = false } = input;
  if (reachedReady || READY_RE.test(text.replace(NOT_READY_RE, ''))) return null;
  if (PORT_RE.test(text) && LOCK_RE.test(text)) return null;

  // スタックは直前のエラーの続きであり、単独では環境原因の根拠にしない。
  let lastFatal: string | null = null;
  for (const line of text.split('\n')) {
    if (FRAME_RE.test(line)) continue;
    const exitCode = EXIT_CODE_RE.exec(line);
    if (
      (exitedBeforeReady && line.trim() === STANDALONE_LOCK_REFUSAL) ||
      LOCK_PARSE_FAILURE_RE.test(line) ||
      FATAL_START_RE.test(line) ||
      /uncaught|unhandled/i.test(line) ||
      (exitCode !== null && Number(exitCode[1]) !== 0 && !/ELIFECYCLE/i.test(line))
    ) {
      lastFatal = line;
    }
  }
  if (lastFatal === null || LOCK_PARSE_FAILURE_RE.test(lastFatal)) return null;
  if (PORT_RE.test(lastFatal)) return 'port_in_use';
  if (LOCK_RE.test(lastFatal)) return 'lock_held';
  return null;
}
