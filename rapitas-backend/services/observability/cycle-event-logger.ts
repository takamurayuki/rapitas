/**
 * Cycle Event Logger
 *
 * Structured, machine-readable event stream for the auto-run perpetual cycle
 * (the "永久機関"). Every lifecycle event — theme idle/resume, backlog 起票,
 * task enqueue, phase transition, completion/block, PR/merge, restart — is
 * appended as a single NDJSON line to a dedicated daily file so an AI monitor
 * can reconstruct the whole timeline by reading one file (no DB queries, no
 * console scraping).
 *
 * This sink is AGENT-FACING: the format is optimised for cheap parsing, not for
 * human reading. The human-facing trail (UI 実行ログ) is the ActivityLog /
 * Notification tables; this logger never replaces those. It is purely additive
 * and, like the central logger, never throws — observability must not crash the
 * cycle it observes.
 */
import { createWriteStream, mkdirSync, type WriteStream } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

/** Stable event taxonomy for the perpetual cycle. Extend as new events appear. */
export type CycleEventName =
  // theme-level auto-run state
  | 'theme.started'
  | 'theme.idle'
  | 'theme.resumed'
  | 'theme.stopped'
  // backlog refill (起票)
  | 'backlog.promoted'
  | 'backlog.refill'
  // task scheduling
  | 'task.selected'
  | 'task.enqueued'
  // scope-overlap deferral (task 573): a candidate was passed over because its
  // plan files overlap an open auto-PR's changed files
  | 'task.deferred'
  // merge barrier (task 573): selection held while the theme's own PR is open
  | 'task.barrier_hold'
  // workflow phase progression
  | 'phase.transition'
  // task terminal / hold states
  | 'task.completed'
  | 'task.blocked'
  | 'task.skipped'
  | 'task.awaiting_approval'
  | 'task.awaiting_answer'
  | 'task.hang_backstop'
  // the task became runnable again between the failure decision and the write
  | 'task.revived'
  // queue-stall self-healing (task 618): residue release + starvation detection
  | 'task.stall_released'
  | 'queue.starvation_detected'
  // zero-progress spin (task 653): a theme reports running but its current task
  // has produced no AgentExecution for the whole threshold window
  | 'theme.zero_progress_detected'
  // git / PR outcomes
  | 'commit.created'
  | 'pr.created'
  | 'pr.merged'
  | 'pr.merge_failed'
  // self-deploy
  | 'restart.triggered';

/**
 * Optional structured fields attached to a cycle event. Keep keys short and
 * stable — they become column-like fields an AI greps on. `cause` carries a
 * machine-readable reason code on failures; `msg` is a short human gloss.
 */
export interface CycleEventFields {
  /** Theme (auto-run unit) id / テーマID */
  theme?: number;
  /** Task id / タスクID */
  task?: number;
  /** Workflow phase or role / フェーズ・ロール */
  phase?: string;
  role?: string;
  /** Status transition endpoints / 遷移前後ステータス */
  from?: string;
  to?: string;
  /** Whether the event represents a successful outcome / 成否 */
  ok?: boolean;
  /** Machine-readable reason/cause code on holds & failures / 機械可読な要因コード */
  cause?: string;
  /** Short human-readable gloss for quick scanning / 走り読み用の短い説明 */
  msg?: string;
  /** Any extra domain fields (prNumber, count, durationMs, ...) */
  [key: string]: unknown;
}

/** Directory holding the daily cycle log files (shares RAPITAS_DATA_DIR with the central logger). */
function getLogsDir(): string {
  const override = process.env.RAPITAS_DATA_DIR;
  const base = override && override.trim().length > 0 ? override : join(homedir(), '.rapitas');
  return join(base, 'logs');
}

/** Local YYYY-MM-DD stamp for a date (defaults to now). */
function dateStamp(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

/**
 * Absolute path of the cycle event NDJSON file for a given day.
 *
 * @param stamp - YYYY-MM-DD day (defaults to today) / 対象日
 * @returns NDJSON file path / NDJSONファイルパス
 */
export function getCycleLogFilePath(stamp: string = dateStamp()): string {
  return join(getLogsDir(), `cycle-${stamp}.ndjson`);
}

// Append-only daily handle, rotated when the local date changes so an always-on
// process keeps writing to "today's" file across midnight.
let currentStamp = '';
let stream: WriteStream | null = null;

function ensureStream(): WriteStream | null {
  const stamp = dateStamp();
  if (stamp === currentStamp && stream) return stream;
  try {
    mkdirSync(getLogsDir(), { recursive: true });
    stream?.end();
    stream = createWriteStream(getCycleLogFilePath(stamp), { flags: 'a' });
    // A WriteStream is an EventEmitter: an async write failure (disk full, file
    // removed) emits 'error', which crashes the process if unhandled. Swallow it
    // — observability must never take down the cycle it observes.
    stream.on('error', () => {});
    currentStamp = stamp;
  } catch {
    // If the file can't be opened, drop file logging rather than crash.
    stream = null;
  }
  return stream;
}

/**
 * Append one cycle event as an NDJSON line. Never throws; failures are dropped.
 *
 * The emitted object is `{ t, evt, ...fields }` with `t` (ISO timestamp) and
 * `evt` (event name) always first so every line is self-describing.
 *
 * @param evt - Event name from the stable taxonomy / イベント名
 * @param fields - Structured fields (theme/task/cause/...) / 付随フィールド
 */
export function logCycleEvent(evt: CycleEventName, fields: CycleEventFields = {}): void {
  // Skip file output under tests so transient test events never pollute the
  // shared daily file (mirrors the central logger's isTest guard). Read at call
  // time so a test can opt into the write path with a scratch RAPITAS_DATA_DIR.
  if (process.env.NODE_ENV === 'test') return;
  try {
    const record: Record<string, unknown> = { t: new Date().toISOString(), evt, ...fields };
    ensureStream()?.write(`${JSON.stringify(record)}\n`);
  } catch {
    // Never let an observability failure propagate into the cycle.
  }
}
