/**
 * HeavyCheckSlot
 *
 * A process-wide FIFO slot shared by every running task's verification, so
 * only N heavy commands (tsc, tests, lint, builds, the runtime check) run at
 * once across tasks. The runtime check holds one slot for its whole launch +
 * browser check (runtime-verification-stage.ts).
 * Not responsible for running the commands or for their timeouts; callers
 * acquire one slot per command and start their own timer after it is granted.
 *
 * Why: with two tasks verifying in parallel on the 4-core host, two tsc runs
 * and a test suite overlapped and task 1548's tsc hit the 180 s cap although
 * the same tsc alone takes 42 s (concern #15748, 2026-11-26).
 *
 * In-process only: runAutomatedVerification is reached from routes and
 * services/workflow inside the backend process; the agent worker never runs it.
 */
import { createLogger } from '../../../config/logger';
import {
  logCycleEvent,
  type CycleEventFields,
  type CycleEventName,
} from '../../observability/cycle-event-logger';

const log = createLogger('agents:heavy-check-slot');

/** Default simultaneous heavy commands across all tasks. */
const DEFAULT_HEAVY_CONCURRENCY = 1;
/** Upper bound for RAPITAS_VERIFY_HEAVY_CONCURRENCY; more defeats the purpose on small hosts. */
const MAX_HEAVY_CONCURRENCY = 8;
/**
 * Default wait limit before failing open (30 min). A hung check or a leaked
 * slot must not stall every task's verification forever; marking the waiter
 * unverifiable would create a new kind of bounce instead.
 */
const DEFAULT_HEAVY_WAIT_MS = 30 * 60_000;
const MAX_TIMER_MS = 2_147_483_647;

/** Schedules `fn` after `ms`; returns a cancel function. Injectable for tests. */
export type SlotScheduler = (fn: () => void, ms: number) => () => void;

/** Options for acquiring a slot. */
export interface HeavySlotOptions {
  /** Wait limit (ms) before failing open. Defaults to RAPITAS_VERIFY_HEAVY_WAIT_MS or 30 min. */
  waitMs?: number;
  /** Timer override for tests. */
  schedule?: SlotScheduler;
}

/** Releases a slot. Idempotent: only the first call frees anything. */
export type ReleaseHeavySlot = () => void;

interface Waiter {
  label: string;
  enqueuedAt: number;
  settled: boolean;
  cancelTimer: () => void;
  grant: () => void;
}

let active = 0;
const queue: Waiter[] = [];

/** Where safety-exception events go; logCycleEvent outside tests. */
export type HeavySlotEventSink = (evt: CycleEventName, fields: CycleEventFields) => void;
let sink: HeavySlotEventSink = logCycleEvent;

/** The two cases that may let heavy checks overlap (task 1553 R7). */
type HeavySlotException = 'verify.heavy_slot_fail_open' | 'verify.heavy_slot_kill_grace_release';

/**
 * Records a heavy-slot safety exception in the cycle log. Both exceptions keep
 * one stuck process from stalling every task's verification forever, but they
 * break the one-at-a-time limit, so each use must leave a trace. Never throws.
 *
 * @param evt - Which exception. / 例外の種類
 * @param fields - Reason, waited time and target command. / 理由・待った時間・対象
 */
export function recordHeavySlotException(evt: HeavySlotException, fields: CycleEventFields): void {
  try {
    sink(evt, fields);
  } catch (err) {
    log.debug({ err, evt }, '[heavy-check-slot] could not record safety exception');
  }
}

/**
 * Replaces the event sink. Tests only — logCycleEvent writes nothing under
 * NODE_ENV=test, so tests need their own sink to see the events.
 *
 * @param s - Sink, or null for the default. / 記録先（null で既定に戻す）
 */
export function setHeavySlotEventSinkForTests(s: HeavySlotEventSink | null): void {
  sink = s ?? logCycleEvent;
}

const defaultSchedule: SlotScheduler = (fn, ms) => {
  const expiresAt = performance.now() + ms;
  let timer: ReturnType<typeof setTimeout>;
  function scheduleNext() {
    const remaining = Math.ceil(expiresAt - performance.now());
    timer = setTimeout(
      remaining <= MAX_TIMER_MS ? fn : scheduleNext,
      Math.min(remaining, MAX_TIMER_MS),
    );
    // 待ち上限のタイマーだけでプロセスを延命しない。
    timer.unref?.();
  }
  scheduleNext();
  return () => clearTimeout(timer);
};

/**
 * Reads RAPITAS_VERIFY_HEAVY_CONCURRENCY (integer 1..8). Anything else → 1,
 * so a typo can never turn the limit into "unlimited".
 *
 * @returns Allowed simultaneous heavy commands. / 同時に走らせてよい重い検査の数
 */
export function resolveHeavyConcurrency(): number {
  const raw = (process.env.RAPITAS_VERIFY_HEAVY_CONCURRENCY ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_HEAVY_CONCURRENCY;
  const n = Number(raw);
  return n >= 1 && n <= MAX_HEAVY_CONCURRENCY ? n : DEFAULT_HEAVY_CONCURRENCY;
}

function resolveWaitMs(override?: number): number {
  if (override !== undefined) return override;
  const raw = (process.env.RAPITAS_VERIFY_HEAVY_WAIT_MS ?? '').trim();
  if (!/^\d+$/.test(raw)) return DEFAULT_HEAVY_WAIT_MS;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? Math.max(n, DEFAULT_HEAVY_WAIT_MS) : DEFAULT_HEAVY_WAIT_MS;
}

function makeRelease(counted: boolean): ReleaseHeavySlot {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    if (!counted) return;
    active = Math.max(0, active - 1);
    drain();
  };
}

/** Hand free slots to waiters in FIFO order; skips waiters that already timed out. */
function drain(): void {
  const limit = resolveHeavyConcurrency();
  while (active < limit && queue.length > 0) {
    const w = queue.shift()!;
    if (w.settled) continue;
    w.settled = true;
    w.cancelTimer();
    active++;
    log.debug(
      { label: w.label, waitedMs: Date.now() - w.enqueuedAt },
      '[heavy-check-slot] granted',
    );
    w.grant();
  }
}

/**
 * Waits for a heavy-check slot.
 *
 * The free-slot check and the counter update happen synchronously (no await
 * between them), so two concurrent callers can never both take the last slot.
 *
 * @param label - What will run, for logs. / ログ用の検査名
 * @param opts - Wait limit and timer override. / 待ちの上限とタイマー差し替え
 * @returns Release function; call it when the command ends. / 終了時に呼ぶ解放関数
 */
export function acquireHeavyCheckSlot(
  label: string,
  opts: HeavySlotOptions = {},
): Promise<ReleaseHeavySlot> {
  if (active < resolveHeavyConcurrency() && queue.length === 0) {
    active++;
    return Promise.resolve(makeRelease(true));
  }
  const waitMs = resolveWaitMs(opts.waitMs);
  const schedule = opts.schedule ?? defaultSchedule;
  return new Promise((resolve) => {
    const waiter: Waiter = {
      label,
      enqueuedAt: Date.now(),
      settled: false,
      cancelTimer: () => {},
      grant: () => resolve(makeRelease(true)),
    };
    waiter.cancelTimer = schedule(() => {
      if (waiter.settled) return;
      waiter.settled = true;
      const idx = queue.indexOf(waiter);
      if (idx >= 0) queue.splice(idx, 1);
      log.warn(
        { label, waitMs, active },
        '[heavy-check-slot] wait limit exceeded; running without a slot (fail-open)',
      );
      recordHeavySlotException('verify.heavy_slot_fail_open', {
        cause: 'wait_limit_exceeded',
        label,
        waitedMs: Date.now() - waiter.enqueuedAt,
        waitLimitMs: waitMs,
        active,
        msg: 'heavy slot wait limit exceeded; ran without a slot',
      });
      resolve(makeRelease(false));
    }, waitMs);
    queue.push(waiter);
  });
}

/**
 * Runs `fn` while holding a heavy-check slot; the slot is released even if `fn` throws.
 *
 * @param label - What will run, for logs. / ログ用の検査名
 * @param fn - The heavy work. / 重い処理
 * @param opts - Wait limit and timer override. / 待ちの上限とタイマー差し替え
 * @returns Whatever `fn` resolves with. / fn の結果
 */
export async function withHeavyCheckSlot<T>(
  label: string,
  fn: () => Promise<T>,
  opts: HeavySlotOptions = {},
): Promise<T> {
  const release = await acquireHeavyCheckSlot(label, opts);
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Current slot usage, for logs and tests.
 *
 * @returns Active holders and live waiters. / 使用中の数と待っている数
 */
export function heavyCheckSlotStats(): { active: number; waiting: number } {
  return { active, waiting: queue.filter((w) => !w.settled).length };
}

/** Clears all state. Tests only. */
export function resetHeavyCheckSlotForTests(): void {
  sink = logCycleEvent;
  active = 0;
  for (const w of queue) {
    w.settled = true;
    w.cancelTimer();
  }
  queue.length = 0;
}
