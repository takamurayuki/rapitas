/**
 * event-loop-lag-watchdog
 *
 * Detects synchronous event-loop stalls and logs them at WARN so they reach
 * the file log (INFO stays console-only in dev). Instrumentation for the
 * recurring ~9.5s silent stalls captured daily at 06:00 (2026-09-03/04,
 * concern #514/#868): a WARN with the lag size next to the surrounding job
 * logs names the culprit.
 *
 * Also self-heals a pathological stall (2026-09-18 incident): a runaway
 * verify-repair loop starved the event loop badly enough that /health never
 * responded for 90+ minutes across three restarts. The operator's only
 * remaining lever was an external OS-level kill of the hung process — which
 * bypasses this app's own graceful shutdown (close listening socket → close
 * SSE → stop agents) and is exactly how port 3001 accumulated orphaned
 * "ghost" LISTEN sockets that never got cleaned up, on top of the original
 * problem. A process that is still ticking (this watchdog's own interval
 * still fires) can always call its OWN graceful shutdown — releasing the
 * port itself is strictly safer than requiring anyone outside the process to
 * force-kill it. Only a FULLY deadlocked event loop (this watchdog's own
 * timer never fires again) is outside what this can catch; that case has no
 * pure-JS remedy and still needs an external actor.
 *
 * NOTE: A single stall is only restart-worthy when the process was burning CPU
 * (2026-10-08..12: five daily restarts, 4 of them at ~06:00 JST, each logged with
 * no section named). The timer only fires after the loop has recovered, so a stall
 * during which the process used almost no CPU ("not-scheduled": OS suspension, AV
 * scan, I/O wait) is already over and a restart fixes nothing while SIGTERMing
 * running agents. Such a stall is logged with stallKind/cpuRatio instead; the
 * cumulative trigger still catches a process that keeps stalling.
 */
import { createLogger } from '../../config/logger';

const log = createLogger('event-loop-lag');

const CHECK_INTERVAL_MS = 500;
const REPORT_THRESHOLD_MS = 2000;
/**
 * A single stall at least this long is pathological on its own — a normal
 * GC pause or heavy-but-legitimate synchronous burst does not run this long
 * in one shot. Self-heal immediately rather than waiting for more evidence.
 */
const CATASTROPHIC_STALL_MS = 15_000;
/** Sliding window for the cumulative-degradation trigger. */
const CUMULATIVE_WINDOW_MS = 120_000;
/**
 * If stalls over REPORT_THRESHOLD_MS sum to at least this much within
 * CUMULATIVE_WINDOW_MS, the process has been unresponsive often enough to be
 * effectively down even without any single catastrophic stall (this is the
 * shape the 2026-09-18 incident actually took: repeated 3-4s stalls, not one
 * giant one).
 */
const CUMULATIVE_TRIGGER_MS = 30_000;

/**
 * Stall CPU ratio below this means the process was not running JS during the
 * stall. Busy synchronous code uses ~1 core; ambiguous values fall to cpu-bound.
 */
const NOT_SCHEDULED_CPU_RATIO = 0.2;

/** Whether the process was burning CPU during a stall. */
export type StallKind = 'cpu-bound' | 'not-scheduled';

/** Classification of a stall derived from process CPU time vs wall time. */
export interface StallDiagnosis {
  stallKind: StallKind;
  cpuRatio: number;
}

/** A named synchronous section that was in flight when a stall was observed. */
export interface ActiveSectionSnapshot {
  name: string;
  runningMs: number;
}

/** A named section that was released during (or just before) the observed stall. */
export interface RecentSectionSnapshot {
  name: string;
  durationMs: number;
  endedAgoMs: number;
}

/**
 * Invoked at most once per watchdog run, when a stall crosses a self-heal threshold.
 * `sections` names the in-flight markEventLoopSection() sections and
 * `recentSections` those released during the stall, so the restart record
 * itself identifies the likely culprit.
 */
export type SelfHealAction = (
  reason: string,
  sections: ActiveSectionSnapshot[],
  recentSections: RecentSectionSnapshot[],
  diagnosis: StallDiagnosis,
) => void;

/**
 * Dynamic import keeps shutdown-sequence.ts (and its Prisma/realtime-service
 * chain) out of this module's static graph — this file must stay importable
 * in isolation for the lag-detection unit tests, which never hit this path.
 */
const defaultSelfHeal: SelfHealAction = (reason, sections, recentSections, diagnosis) => {
  // NOTE: message body stays fixed so normalizeMessage() keeps one signature; the
  // culprit goes in a structured field (2026-09-25 / 10-08 restarts had no cause named).
  log.error(
    {
      reason,
      stallKind: diagnosis.stallKind,
      cpuRatio: diagnosis.cpuRatio,
      ...(sections.length > 0 ? { activeSections: sections } : {}),
      ...(recentSections.length > 0 ? { recentSections } : {}),
      ...processMetrics(),
    },
    '[event-loop-lag] Self-healing restart triggered',
  );
  import('./shutdown-sequence')
    .then(({ scheduleShutdownSequence }) => scheduleShutdownSequence('[event-loop-recovery]', 75))
    .catch((err) => log.error({ err }, '[event-loop-lag] Failed to trigger self-heal restart'));
};

/**
 * Named synchronous-heavy sections currently in flight, keyed by a unique token
 * so concurrent runs of the same name never clear each other. Read only when a
 * stall is reported, so a WARN can name the likely culprit (recurrence of
 * concern #9142/#1033: the stall size alone never identified the source).
 */
const activeSections = new Map<symbol, { name: string; startedAtMs: number }>();

/** Cap on released-section history; read only on a stall, so a short list is enough. */
const RECENT_SECTION_LIMIT = 8;
/**
 * Sections already released by the time a stall is detected. The watchdog timer can
 * only fire after the blocking synchronous code returns, so the culprit has usually
 * been released by then and activeSections is empty (2026-10-08..11: 5 of 5 restarts
 * logged no section, #1208).
 */
let recentSections: Array<{ name: string; startedAtMs: number; endedAtMs: number }> = [];

function processMetrics(): { heapUsedMb: number; rssMb: number } {
  const { heapUsed, rss } = process.memoryUsage();
  return { heapUsedMb: Math.round(heapUsed / 1048576), rssMb: Math.round(rss / 1048576) };
}

/**
 * Registers a named section as running so a stall WARN emitted meanwhile lists it.
 *
 * @param name - Section label (e.g. "log-health-check") / セクション名
 * @returns Idempotent release function; call it in a finally block / 解除関数(冪等)
 */
export function markEventLoopSection(name: string): () => void {
  const token = Symbol(name);
  const startedAtMs = Date.now();
  activeSections.set(token, { name, startedAtMs });
  return () => {
    if (!activeSections.delete(token)) return;
    recentSections.push({ name, startedAtMs, endedAtMs: Date.now() });
    if (recentSections.length > RECENT_SECTION_LIMIT) {
      recentSections = recentSections.slice(-RECENT_SECTION_LIMIT);
    }
  };
}

/** Process CPU time (user+system) in ms, or null when unavailable. */
function readCpuMs(): number | null {
  try {
    const { user, system } = process.cpuUsage();
    const ms = (user + system) / 1000;
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

/**
 * Classifies a stall from the CPU time consumed since the previous tick.
 *
 * @param cpuMs - CPU ms now / 現在のCPU時間
 * @param prevCpuMs - CPU ms at the previous tick / 前回tickのCPU時間
 * @param elapsedMs - Wall ms since the previous tick / 前回tickからの実経過時間
 * @returns not-scheduled only on clear evidence; anything unmeasurable is cpu-bound (fail-safe: restart)
 */
function diagnoseStall(
  cpuMs: number | null,
  prevCpuMs: number | null,
  elapsedMs: number,
): StallDiagnosis {
  if (cpuMs === null || prevCpuMs === null || elapsedMs <= 0) {
    return { stallKind: 'cpu-bound', cpuRatio: 1 };
  }
  const delta = cpuMs - prevCpuMs;
  if (!Number.isFinite(delta) || delta < 0) return { stallKind: 'cpu-bound', cpuRatio: 1 };
  const cpuRatio = Math.round((delta / elapsedMs) * 100) / 100;
  return {
    stallKind: cpuRatio < NOT_SCHEDULED_CPU_RATIO ? 'not-scheduled' : 'cpu-bound',
    cpuRatio,
  };
}

let handle: ReturnType<typeof setInterval> | null = null;
let recentStalls: Array<{ atMs: number; lagMs: number }> = [];
let healingTriggered = false;

/**
 * Formats the stall message with a fixed one-decimal-place digit shape (e.g.
 * "2.0" not "2") so log-health-check's normalizeMessage() always folds these
 * into the same "~#.#s" signature instead of splitting integer-second lags
 * into a separate concern series (task #864).
 */
export function formatEventLoopLagMessage(lagMs: number): string {
  return `Event loop stalled ~${(lagMs / 1000).toFixed(1)}s`;
}

/**
 * Start the watchdog. Safe to call multiple times.
 *
 * @param selfHeal - Called at most once, when a stall crosses a self-heal
 *   threshold; defaults to the real graceful-restart sequence. Tests inject
 *   a spy instead. / 自己修復アクション(テストではスパイに差し替え)
 */
export function startEventLoopLagWatchdog(selfHeal: SelfHealAction = defaultSelfHeal): void {
  if (handle) return;
  recentStalls = [];
  recentSections = [];
  healingTriggered = false;
  let expected = Date.now() + CHECK_INTERVAL_MS;
  let lastTickAtMs = Date.now();
  let lastCpuMs = readCpuMs();
  handle = setInterval(() => {
    const now = Date.now();
    const lagMs = now - expected;
    expected = now + CHECK_INTERVAL_MS;
    const cpuMs = readCpuMs();
    const diagnosis = diagnoseStall(cpuMs, lastCpuMs, now - lastTickAtMs);
    lastCpuMs = cpuMs;
    lastTickAtMs = now;
    if (lagMs > REPORT_THRESHOLD_MS) {
      // NOTE: message body stays unchanged so normalizeMessage() keeps folding
      // every stall into one "~#.#s" signature; the culprit goes in a structured field.
      const sections = [...activeSections.values()].map((section) => ({
        name: section.name,
        runningMs: now - section.startedAtMs,
      }));
      // A section released at or after the expected tick time overlapped the stall.
      const stallStartedAtMs = now - lagMs;
      const released = recentSections
        .filter((section) => section.endedAtMs >= stallStartedAtMs)
        .reverse()
        .map((section) => ({
          name: section.name,
          durationMs: section.endedAtMs - section.startedAtMs,
          endedAgoMs: now - section.endedAtMs,
        }));
      const skipSingleStallHeal =
        lagMs >= CATASTROPHIC_STALL_MS && diagnosis.stallKind === 'not-scheduled';
      log.warn(
        {
          lagMs,
          stallKind: diagnosis.stallKind,
          cpuRatio: diagnosis.cpuRatio,
          ...(skipSingleStallHeal ? { selfHealSkipped: 'not-scheduled-single-stall' } : {}),
          ...(sections.length > 0 ? { activeSections: sections } : {}),
          ...(released.length > 0 ? { recentSections: released } : {}),
          ...processMetrics(),
        },
        formatEventLoopLagMessage(lagMs),
      );
      recentStalls.push({ atMs: now, lagMs });
      recentStalls = recentStalls.filter((stall) => now - stall.atMs <= CUMULATIVE_WINDOW_MS);
      if (!healingTriggered) {
        if (lagMs >= CATASTROPHIC_STALL_MS && !skipSingleStallHeal) {
          healingTriggered = true;
          selfHeal(
            `single stall of ${lagMs}ms reached the ${CATASTROPHIC_STALL_MS}ms threshold`,
            sections,
            released,
            diagnosis,
          );
        } else {
          const cumulativeMs = recentStalls.reduce((sum, stall) => sum + stall.lagMs, 0);
          if (cumulativeMs >= CUMULATIVE_TRIGGER_MS) {
            healingTriggered = true;
            selfHeal(
              `cumulative stall of ${cumulativeMs}ms within the last ${CUMULATIVE_WINDOW_MS}ms reached the ${CUMULATIVE_TRIGGER_MS}ms threshold`,
              sections,
              released,
              diagnosis,
            );
          }
        }
      }
    }
  }, CHECK_INTERVAL_MS);
}

/** Stop the watchdog (tests / shutdown). */
export function stopEventLoopLagWatchdog(): void {
  if (handle) {
    clearInterval(handle);
    handle = null;
  }
  recentStalls = [];
  recentSections = [];
  healingTriggered = false;
  activeSections.clear();
}
