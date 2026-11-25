/**
 * phase-segmentation
 *
 * Pure functions that group a task's `AgentExecution` rows into the
 * research/plan/implement/verify timeline shown on the task-detail execution
 * log (task #785). `WorkflowTransition.executionId` is never populated by any
 * caller (see research.md 前提監査#3), so phase identity comes directly from
 * each execution's `AgentSession.mode` (`workflow-<role>`) — a call-time
 * value the orchestrator already sets, not a timestamp guess. Iteration
 * numbers (differencing "実装 (2回目)" from "実装 (1回目)") come from counting
 * `verify_repair` / `ci_repair` WorkflowTransition rows that precede each
 * execution — the only two causes that represent a repair-loop bounce back
 * to the implementer (see plan.md 設計判断の根拠 #6). Not responsible for DB
 * access — callers query WorkflowTransition/AgentExecution/AgentSession and
 * pass the already-fetched rows in here.
 */

export const PHASE_ORDER = ['research', 'plan', 'implement', 'verify'] as const;

/** One of the four timeline sections, populated from recorded executions. */
export type PhaseType = (typeof PHASE_ORDER)[number];

export type PhaseRunStatus = 'running' | 'completed' | 'failed';

const REPAIR_CAUSES = new Set(['verify_repair', 'ci_repair']);

/** Boundary-correlation tolerance between an execution's completion and the nearest WorkflowTransition (task #785 plan.md 設計判断#1). */
const BOUNDARY_TOLERANCE_MS = 3000;

const SESSION_MODE_TO_PHASE: Record<string, PhaseType> = {
  'workflow-researcher': 'research',
  'workflow-planner': 'plan',
  'workflow-implementer': 'implement',
  'workflow-verifier': 'verify',
  'workflow-auto_verifier': 'verify',
};

/**
 * Maps an `AgentSession.mode` value to the timeline phase it belongs to.
 *
 * @param sessionMode - `AgentSession.mode` (e.g. `"workflow-implementer"`), or null for non-workflow runs / 実行に紐づくセッションモード
 * @returns The phase this session's executions belong to, or null when the mode isn't a recognized workflow role / 該当フェーズ、判定不能な場合は null
 */
export function selectPhaseType(sessionMode: string | null | undefined): PhaseType | null {
  if (!sessionMode) return null;
  return SESSION_MODE_TO_PHASE[sessionMode] ?? null;
}

/** Shape of one `AgentExecution` row (already joined with its session for `phaseType`). */
export interface RawPhaseExecution {
  id: number;
  phaseType: PhaseType | null;
  /** `AgentExecution.status` — 'pending' | 'running' | 'completed' | 'failed' | ... */
  status: string;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
  createdAt: Date | string;
  /** Pre-aggregated `AgentExecutionLog` row count for this execution. */
  logLineCount: number;
}

/** Shape of one `WorkflowTransition` row (any cause — only repair causes affect iteration counting). */
export interface RawPhaseTransition {
  cause: string | null;
  createdAt: Date | string;
  /** Status before the move; absent on older callers. / 遷移前のステータス */
  fromStatus?: string | null;
  /** Status after the move; absent on older callers. / 遷移後のステータス */
  toStatus?: string | null;
}

// Order of the workflow statuses; a move to a lower rank sends the task back.
const STATUS_RANK: Readonly<Record<string, number>> = {
  draft: 0,
  research_done: 1,
  plan_created: 2,
  plan_approved: 3,
  in_progress: 4,
  verify_done: 5,
  completed: 6,
};

/**
 * The status a phase starts from: a send-back to it or earlier re-runs the phase.
 * Lightweight tasks implement straight from research_done (no plan phase).
 */
function entryRank(phase: PhaseType, hasPlanPhase: boolean): number {
  if (phase === 'research') return STATUS_RANK.draft;
  if (phase === 'plan') return STATUS_RANK.research_done;
  if (phase === 'implement')
    return hasPlanPhase ? STATUS_RANK.plan_approved : STATUS_RANK.research_done;
  return STATUS_RANK.in_progress;
}

/**
 * The rank a transition sends the task back to, or null when it is not a send-back.
 * A repair cause with no recorded status keeps its old meaning (implement / verify).
 */
function sendBackRank(t: RawPhaseTransition): number | null {
  const to = t.toStatus != null ? STATUS_RANK[t.toStatus] : undefined;
  const from = t.fromStatus != null ? STATUS_RANK[t.fromStatus] : undefined;
  if (to !== undefined && from !== undefined && to < from) return to;
  // awaiting_question has no rank; a plan revision from it re-runs planning.
  if (t.cause === 'plan_revision_requested' && to !== undefined) return to;
  if (t.cause && REPAIR_CAUSES.has(t.cause)) return to ?? STATUS_RANK.plan_approved;
  return null;
}

/** One run of a phase (iteration 1 is the first attempt; 2+ follow a verify_repair/ci_repair bounce). */
export interface PhaseIteration {
  iterationNumber: number;
  executionIds: number[];
  startedAt: string | null;
  completedAt: string | null;
  status: PhaseRunStatus;
  logLineCount: number;
  /** True when no WorkflowTransition landed within ±3s of this iteration's completion — the boundary is a best-effort guess, not confirmed (plan.md エッジケースの方針). */
  boundaryUncertain: boolean;
}

/** All iterations of one timeline phase, in chronological (iteration number) order. */
export interface PhaseSegment {
  phaseType: PhaseType;
  iterations: PhaseIteration[];
}

export type WorkflowTimelineMode = 'lightweight' | 'standard' | 'comprehensive';

export interface SegmentPhasesResult {
  phases: PhaseSegment[];
  workflowMode: WorkflowTimelineMode;
}

function toTime(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function isRunStatus(status: string): boolean {
  return status === 'pending' || status === 'running';
}

function isFailedStatus(status: string): boolean {
  return status === 'failed' || status === 'error' || status === 'cancelled';
}

/**
 * Groups a task's agent executions into research/plan/implement/verify
 * phase segments, splitting `implement`/`verify` into repair iterations.
 *
 * @param executions - Task's AgentExecution rows (any session, any order) with phaseType pre-derived via {@link selectPhaseType} / 実行行
 * @param transitions - Task's WorkflowTransition rows (any cause) / 遷移ログ
 * @param hasPlanFile - Whether a `plan` WorkflowFile row exists for the task (plan.md 設計判断#5) / plan.md の存在有無
 * @returns Ordered phase segments plus the derived workflow mode / フェーズ区分とワークフローモード
 */
export function segmentPhases(
  executions: RawPhaseExecution[],
  transitions: RawPhaseTransition[],
  hasPlanFile: boolean,
): SegmentPhasesResult {
  // A planner runs before plan.md exists; answering a question also archives
  // the old plan. Neither case may hide its live or historical execution logs.
  const hasPlanningExecution = executions.some((execution) => execution.phaseType === 'plan');
  const workflowMode: WorkflowTimelineMode =
    hasPlanFile || hasPlanningExecution ? 'standard' : 'lightweight';

  // NOTE: Rounds were split only on verify_repair / ci_repair, so the send-backs
  // added since (evidence re-plan, plan / research critics, plan revision after
  // an answer, retries) folded every round into one and the round tabs vanished
  // (2026-11-25). Any move back to a phase's start status now opens a round.
  const sendBacks = transitions
    .map((t) => ({ rank: sendBackRank(t), time: toTime(t.createdAt) }))
    .filter((b): b is { rank: number; time: number } => b.rank !== null);
  const hasPlanPhase = workflowMode !== 'lightweight';

  const allTransitionTimes = transitions.map((t) => toTime(t.createdAt));

  const sorted = executions
    .filter((e) => e.phaseType !== null)
    .map((e) => ({ ...e, time: toTime(e.startedAt ?? e.createdAt) }))
    .sort((a, b) => a.time - b.time || a.id - b.id);

  const byPhase = new Map<PhaseType, typeof sorted>();
  for (const type of PHASE_ORDER) byPhase.set(type, []);
  for (const e of sorted) byPhase.get(e.phaseType as PhaseType)!.push(e);

  const phases: PhaseSegment[] = [];
  for (const phaseType of PHASE_ORDER) {
    const execs = byPhase.get(phaseType)!;
    if (execs.length === 0) continue;

    const phaseEntry = entryRank(phaseType, hasPlanPhase);
    const phaseSendBacks = sendBacks.filter((b) => b.rank <= phaseEntry).map((b) => b.time);

    const iterationGroups = new Map<number, typeof execs>();
    for (const e of execs) {
      const iterationNumber = phaseSendBacks.filter((rt) => rt < e.time).length + 1;
      const group = iterationGroups.get(iterationNumber) ?? [];
      group.push(e);
      iterationGroups.set(iterationNumber, group);
    }

    // NOTE: The group key is "send-backs before this run + 1"; it groups runs
    // but is not the round number. Send-backs before a phase's first run, or
    // several with no run between them, made the tabs read 2, 4, 5 (task 1548,
    // 2026-11-26), so the rounds that ran are numbered 1, 2, 3 in order.
    const iterations: PhaseIteration[] = [...iterationGroups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, group], index) => {
        const iterationNumber = index + 1;
        const first = group[0];
        const last = group[group.length - 1];
        const completedAt = last.completedAt ? toIso(last.completedAt) : null;
        // Retries retain their logs, but the latest execution determines the
        // current outcome, just as it determines completedAt below.
        const status: PhaseRunStatus = isRunStatus(last.status)
          ? 'running'
          : isFailedStatus(last.status)
            ? 'failed'
            : 'completed';
        const boundaryUncertain =
          completedAt !== null &&
          !allTransitionTimes.some(
            (tt) =>
              Math.abs(tt - toTime(last.completedAt as Date | string)) <= BOUNDARY_TOLERANCE_MS,
          );
        return {
          iterationNumber,
          executionIds: group.map((g) => g.id),
          startedAt: toIso(first.startedAt ?? first.createdAt),
          completedAt,
          status,
          logLineCount: group.reduce((sum, g) => sum + g.logLineCount, 0),
          boundaryUncertain,
        };
      });

    phases.push({ phaseType, iterations });
  }

  return { phases, workflowMode };
}
