/**
 * codex-cli-events
 *
 * Reads the JSONL event stream of a one-shot `codex exec --json` call into the
 * answer, the failure text and the token usage. Pure string handling — no
 * spawning, no I/O. Not responsible for the agent-execution event handling in
 * services/agents/codex-cli-agent (worktree runs, questions, artifacts).
 *
 * NOTE: Event shapes checked on codex-cli 0.164.0-alpha.9 (2026-11-11):
 *   {"type":"thread.started","thread_id":…}
 *   {"type":"item.completed","item":{"type":"error","message":…}}   ← a WARNING
 *     (unrecognised config key, code-mode host missing …), not a failure
 *   {"type":"item.completed","item":{"type":"agent_message","text":…}}  (a
 *     preamble may come first; the LAST one is the answer)
 *   {"type":"turn.completed","usage":{input_tokens, cached_input_tokens,
 *     output_tokens, …}}
 * `turn.failed` ({error:{message}}) and top-level `error` ({message}) follow
 * the shapes the agent runner already reads (json-event-handler.ts). Shapes
 * may change between alpha releases; anything unknown is ignored, and a run
 * without a completed turn AND an answer is a failure (fail closed).
 */

/** Token usage as reported on `turn.completed`. */
export interface CodexUsage {
  /** Total prompt tokens, cached ones included (OpenAI's convention). */
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** What one `codex exec --json` run said. */
export interface CodexRunSummary {
  /** The final agent message, or null when none was produced. */
  text: string | null;
  /** True only when a turn completed, none failed, and an answer exists. */
  succeeded: boolean;
  /**
   * The failure reason the CLI reported in the event stream (turn.failed >
   * top-level error event), or null — also null on a failure the stream did
   * not explain. Warnings and canned defaults are NOT folded in here, so a
   * caller can still prefer stderr (see describeCodexFailure).
   */
  failureMessage: string | null;
  /** True when a `turn.completed` event was seen. */
  turnCompleted: boolean;
  usage: CodexUsage | null;
  /** Non-fatal `item.completed` error items, kept for logging. */
  warnings: string[];
}

type JsonRecord = Record<string, unknown>;

function asRecord(v: unknown): JsonRecord | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonRecord) : null;
}

function nonNegative(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function messageOf(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  const rec = asRecord(v);
  if (rec && typeof rec.message === 'string' && rec.message.trim()) return rec.message.trim();
  return null;
}

/**
 * Summarise the stdout of `codex exec --json`.
 *
 * @param stdout - Raw JSONL stdout / 標準出力（JSONL）
 * @returns Answer, success flag, failure text and usage / 応答・成否・失敗理由・使用量
 */
export function parseCodexJsonl(stdout: string): CodexRunSummary {
  let text: string | null = null;
  let turnCompleted = false;
  let turnFailed: string | null = null;
  let lastError: string | null = null;
  let usage: CodexUsage | null = null;
  const warnings: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    let event: JsonRecord | null;
    try {
      event = asRecord(JSON.parse(trimmed));
    } catch {
      continue;
    }
    if (!event) continue;
    switch (event.type) {
      case 'item.completed': {
        const item = asRecord(event.item);
        if (item?.type === 'agent_message' && typeof item.text === 'string') {
          text = item.text;
        } else if (item?.type === 'error') {
          const msg = messageOf(item);
          if (msg) warnings.push(msg);
        }
        break;
      }
      case 'turn.completed': {
        turnCompleted = true;
        const u = asRecord(event.usage);
        if (u) {
          usage = {
            inputTokens: nonNegative(u.input_tokens),
            cachedInputTokens: nonNegative(u.cached_input_tokens),
            outputTokens: nonNegative(u.output_tokens),
          };
        }
        break;
      }
      case 'turn.failed':
        // Only the first failure is kept, as in the agent runner.
        turnFailed ??= messageOf(event.error) ?? messageOf(event.message) ?? 'turn failed';
        break;
      case 'error':
        lastError = messageOf(event.message) ?? messageOf(event.error) ?? lastError;
        break;
      default:
        break;
    }
  }

  const answered = text !== null && text.trim() !== '';
  const succeeded = turnCompleted && turnFailed === null && answered;
  return {
    text: answered ? text : null,
    succeeded,
    failureMessage: succeeded ? null : (turnFailed ?? lastError),
    turnCompleted,
    usage,
    warnings,
  };
}

/** stderr beyond this is cut from the front: the CLI prints the reason last. */
const STDERR_TAIL_CHARS = 1000;

/**
 * The diagnostic text for a failed run, in order of trust: the structured
 * reason from the event stream, then stderr, then the last warning item, then
 * a canned default.
 *
 * NOTE: stderr must come before the defaults (routing2b G2 finding 2): with an
 * empty stdout the CLI reports "Not logged in" / "usage limit … try again at"
 * only on stderr, and that text is what the cooldown classifier reads. It also
 * comes before warning items, which every run emits (unknown `-c features.*`
 * keys) and which never explain a failure.
 *
 * @param summary - Parsed stdout / 解析済みの標準出力
 * @param stderr - Raw stderr of the same run / 同じ実行の標準エラー出力
 * @returns Non-empty failure text / 失敗理由（空でない）
 */
export function describeCodexFailure(summary: CodexRunSummary, stderr: string): string {
  if (summary.failureMessage) return summary.failureMessage;
  const err = stderr.trim();
  if (err) return err.length > STDERR_TAIL_CHARS ? err.slice(-STDERR_TAIL_CHARS) : err;
  const warning = summary.warnings[summary.warnings.length - 1];
  if (warning) return warning;
  return summary.turnCompleted
    ? 'Codex CLI returned no answer'
    : 'Codex CLI did not complete a turn';
}
