/**
 * root-cause-detector
 *
 * Finds tasks whose stall/failure is followed by a cascade of failures in dependent tasks,
 * and predicts which still-queued dependents are at risk. Pure; proposes only — never
 * quarantines anything itself (a false isolation would stop a healthy task).
 */
import { buildDependencyGraph, collectDownstream } from './causal-graph';
import { isHaltSideTransitionCause } from '../task-iteration-budget';

/** Max gap between a root's onset and a dependent's failure to be attributed to it. */
export const CAUSAL_WINDOW_MS = 30 * 60 * 1000;
/** Fewer downstream failures than this cannot be told apart from independent failures. */
export const MIN_CASCADE_SIZE = 2;
/** A non-terminal root older than this (since start/queue) counts as stalled. */
export const SLOW_ROOT_MS = 10 * 60 * 1000;

/** Queue-item fields the detector reads. */
export interface CausalQueueItem {
  taskId: number;
  status: string;
  dependencies: string | null;
  queuedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  errorMessage: string | null;
}

/** A proposed common-cause task with the evidence behind it. */
export interface RootCauseCandidate {
  taskId: number;
  /** Epoch ms the root's trouble started (startedAt, else queuedAt). */
  onsetMs: number;
  downstreamFailedIds: number[];
  /** Dependents not failed yet but still queued: where the cascade will spread next. */
  atRiskIds: number[];
  /** Failed dependents / dependents with a queue row (normalised by volume, not a raw count). */
  confidence: number;
  evidence: string;
}

const NON_TERMINAL = new Set(['queued', 'running', 'waiting_approval']);

// Halt/backstop failures are stop-side artefacts, not work failures (self-count guard).
const isControlFailure = (i: CausalQueueItem): boolean =>
  [...(i.errorMessage?.split(/[\s:,]+/) ?? [])].some((w) => isHaltSideTransitionCause(w));

/**
 * Detects root-cause candidates for dependency-chain failures.
 *
 * @param items - Queue items in the analysis scope. / 分析対象のキューアイテム
 * @param nowMs - Current epoch ms (injected for determinism). / 現在時刻(ms)
 * @returns Candidates with >= MIN_CASCADE_SIZE attributed failures, strongest first. / 根因候補
 */
export function detectRootCauses(items: CausalQueueItem[], nowMs: number): RootCauseCandidate[] {
  const graph = buildDependencyGraph(items);
  const byTask = new Map(items.map((i) => [i.taskId, i]));
  const out: RootCauseCandidate[] = [];

  for (const root of items) {
    const onset = (root.startedAt ?? root.queuedAt).getTime();
    const rootStalled = NON_TERMINAL.has(root.status) && nowMs - onset >= SLOW_ROOT_MS;
    const rootFailed = root.status === 'failed' && !isControlFailure(root);
    if (!rootStalled && !rootFailed) continue;
    // A dependent can only be blamed once the root is demonstrably in trouble: after it
    // had been stalled for SLOW_ROOT_MS, or at/after its own failure. Earlier failures
    // have some other cause.
    const troubleAt = rootFailed
      ? (root.completedAt ?? root.queuedAt).getTime()
      : onset + SLOW_ROOT_MS;

    // Only dependents we actually have rows for count (a missing row is not evidence either way).
    const downstream = [...collectDownstream(graph, root.taskId)].filter((id) => byTask.has(id));
    const failed: number[] = [];
    const atRisk: number[] = [];
    for (const id of downstream) {
      const d = byTask.get(id) as CausalQueueItem;
      const at = d.completedAt?.getTime();
      const attributable = at !== undefined && at >= troubleAt && at - onset <= CAUSAL_WINDOW_MS;
      if (d.status === 'failed' && !isControlFailure(d) && attributable) failed.push(id);
      else if (d.status === 'queued') atRisk.push(id);
    }
    if (failed.length < MIN_CASCADE_SIZE) continue;

    out.push({
      taskId: root.taskId,
      onsetMs: onset,
      downstreamFailedIds: failed,
      atRiskIds: atRisk,
      confidence: failed.length / downstream.length,
      evidence:
        `task ${root.taskId} (${root.status}) onset ${new Date(onset).toISOString()}; ` +
        `${failed.length}/${downstream.length} dependents failed within ` +
        `${CAUSAL_WINDOW_MS / 60000}min: [${failed.join(', ')}]`,
    });
  }

  // A candidate that is itself blamed on another candidate is a symptom, not a second root
  // (A -> B -> C,D must not yield both A and B).
  const symptomIds = new Set(out.flatMap((c) => c.downstreamFailedIds));
  return out
    .filter((c) => !symptomIds.has(c.taskId))
    .sort(
      (a, b) =>
        b.confidence - a.confidence || b.downstreamFailedIds.length - a.downstreamFailedIds.length,
    );
}
