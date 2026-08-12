/**
 * ExperimentLifecycle
 *
 * Thin I/O layer of the self-experiment loop: create an experiment from a
 * ledger hypothesis (control window measured up-front), advance it on each
 * completed task, and judge/settle it once the treatment window fills. All
 * judgement logic lives in experiment-metrics (pure); all persistence in
 * experiment-store. An improved verdict feeds the existing PromptEvolution
 * approval queue (status 'proposed' — human approval remains the final gate);
 * a regressed verdict rolls back by clearing the active experiment (the
 * intervention never reaches 'approved', so removal IS the rollback).
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { addEvidence, getHypothesis, setHypothesisStatus } from '../../memory/hypothesis-service';
import type { RetroTransitionRow } from '../../workflow/process-retro/retro-types';
import {
  DEFAULT_TARGET_N,
  MIN_SAMPLES,
  computeTaskMetrics,
  judgeExperiment,
} from './experiment-metrics';
import {
  appendExperimentHistory,
  clearActiveExperiment,
  readActiveExperiment,
  writeActiveExperiment,
} from './experiment-store';
import type { ActiveExperiment, ExperimentMetrics, ExperimentVerdict } from './experiment-types';

const log = createLogger('self-learning:experiment-lifecycle');

/** Max intervention length — mirrors prompt-evolution-worker MAX_ADDENDUM_CHARS. */
const MAX_ADDENDUM_CHARS = 1200;

/** Candidate over-fetch floor so role filtering still fills the control window. */
const CANDIDATE_FLOOR = 25;

/** Result of attempting to create an experiment. */
export interface CreateExperimentResult {
  ok: boolean;
  /** Experiment id when created. / 作成された実験ID */
  id?: string;
  /** Rejection reason when ok is false. / 拒否理由 */
  reason?: string;
}

/**
 * Recent completed top-level tasks the given role participated in, newest
 * first. Population definition (fixed by plan): parentId=null AND status in
 * done/completed AND has a WorkflowTransition with actor=role.
 */
async function findRoleCompletedTaskIds(role: string, limit: number): Promise<number[]> {
  const candidates = await prisma.task.findMany({
    where: { parentId: null, status: { in: ['done', 'completed'] } },
    orderBy: [{ completedAt: 'desc' }, { updatedAt: 'desc' }],
    take: Math.max(limit * 5, CANDIDATE_FLOOR),
    select: { id: true },
  });
  if (candidates.length === 0) return [];
  const involved = await prisma.workflowTransition.findMany({
    where: { taskId: { in: candidates.map((c) => c.id) }, actor: role },
    select: { taskId: true },
    distinct: ['taskId'],
  });
  const involvedSet = new Set(involved.map((r) => r.taskId));
  return candidates
    .filter((c) => involvedSet.has(c.id))
    .map((c) => c.id)
    .slice(0, limit);
}

/** Fetch all transitions for the given tasks, grouped per task id. */
async function fetchTransitionsByTask(
  taskIds: number[],
): Promise<Map<number, RetroTransitionRow[]>> {
  const byTask = new Map<number, RetroTransitionRow[]>(taskIds.map((id) => [id, []]));
  if (taskIds.length === 0) return byTask;
  const rows = await prisma.workflowTransition.findMany({
    where: { taskId: { in: taskIds } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      taskId: true,
      fromStatus: true,
      toStatus: true,
      actor: true,
      cause: true,
      phase: true,
      metadata: true,
      invariantViolation: true,
      createdAt: true,
    },
  });
  for (const { taskId, ...row } of rows) {
    byTask.get(taskId)?.push(row);
  }
  return byTask;
}

/** Human-readable one-line comparison used in evidence and proposal reasons. */
function summarizeComparison(control: ExperimentMetrics, treatment: ExperimentMetrics): string {
  const pct = (v: number): string => `${Math.round(v * 100)}%`;
  return (
    `批評通過率 ${pct(control.criticPassRate)}→${pct(treatment.criticPassRate)}, ` +
    `平均修復 ${control.avgRepair.toFixed(2)}→${treatment.avgRepair.toFixed(2)}回, ` +
    `平均所要 ${(control.avgDurationMs / 60_000).toFixed(1)}→${(treatment.avgDurationMs / 60_000).toFixed(1)}分 ` +
    `(control n=${control.sampleSize} / treatment n=${treatment.sampleSize})`
  );
}

/**
 * Create an experiment from an open agent-behavior hypothesis. Refuses when an
 * experiment is already running (at most ONE concurrent experiment — the
 * confounding guard), when the hypothesis is out of scope, or when the control
 * window is too small to compare against.
 *
 * @param hypothesisId - Ledger hypothesis to test. / 検証対象の仮説ID
 * @param role - Workflow role receiving the intervention. / 介入対象ロール
 * @param addendum - Reversible prompt addendum (<=1200 chars). / 介入文
 * @returns ok+id, or ok:false+reason. / 生成結果
 */
export async function createExperimentFromHypothesis(
  hypothesisId: number,
  role: string,
  addendum: string,
): Promise<CreateExperimentResult> {
  if (readActiveExperiment()) {
    return { ok: false, reason: '既にアクティブな実験が存在します(同時実験は1本まで)' };
  }
  const trimmedRole = (role ?? '').trim();
  if (!trimmedRole) return { ok: false, reason: 'role が必要です' };
  const text = (addendum ?? '').trim().slice(0, MAX_ADDENDUM_CHARS);
  if (!text) return { ok: false, reason: 'addendum (介入文) が必要です' };

  const hypothesis = await getHypothesis(hypothesisId);
  if (!hypothesis) return { ok: false, reason: '仮説が見つかりません' };
  if (hypothesis.domain !== 'agent-behavior') {
    return { ok: false, reason: "実験対象は domain='agent-behavior' の仮説のみです" };
  }
  if (hypothesis.status !== 'open') {
    return { ok: false, reason: "実験対象は status='open' (検証待ち) の仮説のみです" };
  }

  const targetN = DEFAULT_TARGET_N;
  const controlTaskIds = await findRoleCompletedTaskIds(trimmedRole, targetN);
  const controlMetrics = computeTaskMetrics(await fetchTransitionsByTask(controlTaskIds));
  if (controlMetrics.sampleSize < MIN_SAMPLES) {
    return {
      ok: false,
      reason: `対照窓のサンプル数が不足しています (${controlMetrics.sampleSize}件 < 最小${MIN_SAMPLES}件)`,
    };
  }

  const experiment: ActiveExperiment = {
    id: `exp_${hypothesisId}_${Date.now()}`,
    hypothesisId,
    statement: hypothesis.statement,
    role: trimmedRole,
    addendum: text,
    targetN,
    status: 'running',
    startedAt: new Date().toISOString(),
    controlMetrics,
    treatmentTaskIds: [],
  };
  if (!writeActiveExperiment(experiment)) {
    return { ok: false, reason: '実験状態の保存に失敗しました' };
  }
  log.info(
    { id: experiment.id, hypothesisId, role: trimmedRole, targetN, controlMetrics },
    '[experiment] Experiment started',
  );
  return { ok: true, id: experiment.id };
}

/**
 * Advance the active experiment on a terminal task: completed top-level tasks
 * the intervention role participated in join the treatment window; reaching
 * targetN triggers judgement exactly once. Best-effort — never throws into
 * the outcome-telemetry chain.
 *
 * @param taskId - The task that just ended. / 終了したタスク
 * @param finalStatus - Terminal status ('completed'/'blocked'/...). / 最終状態
 */
export async function updateExperimentProgress(taskId: number, finalStatus: string): Promise<void> {
  try {
    const experiment = readActiveExperiment();
    if (!experiment) return;
    if (finalStatus !== 'completed' && finalStatus !== 'done') return;
    if (experiment.treatmentTaskIds.includes(taskId)) return;

    const task = await prisma.task
      .findUnique({ where: { id: taskId }, select: { parentId: true } })
      .catch(() => null);
    if (!task || task.parentId !== null) return;
    const involved = await prisma.workflowTransition
      .findFirst({ where: { taskId, actor: experiment.role }, select: { id: true } })
      .catch(() => null);
    if (!involved) return;

    experiment.treatmentTaskIds = [...experiment.treatmentTaskIds, taskId];
    writeActiveExperiment(experiment);
    log.info(
      {
        id: experiment.id,
        taskId,
        progress: `${experiment.treatmentTaskIds.length}/${experiment.targetN}`,
      },
      '[experiment] Treatment task recorded',
    );
    if (experiment.treatmentTaskIds.length >= experiment.targetN) {
      await finalizeExperiment();
    }
  } catch (err) {
    log.warn({ err, taskId }, '[experiment] Progress update failed (best-effort)');
  }
}

/**
 * Judge the active experiment and settle it: improved → PromptEvolution
 * proposal with measured evidence + hypothesis supported; regressed → rollback
 * (clear) + hypothesis refuted; otherwise inconclusive. The active file is
 * cleared FIRST so re-entry can never judge the same experiment twice.
 *
 * @returns The verdict, or null when no experiment was running. / 判定結果
 */
export async function finalizeExperiment(): Promise<ExperimentVerdict | null> {
  const experiment = readActiveExperiment();
  if (!experiment) return null;
  // Cleared before any judgement I/O: a concurrent/re-entrant call reads null
  // and returns, so promptEvolution.create / hypothesis updates run at most once.
  clearActiveExperiment();

  const treatment = computeTaskMetrics(await fetchTransitionsByTask(experiment.treatmentTaskIds));
  const verdict = judgeExperiment(experiment.controlMetrics, treatment);
  const summary = summarizeComparison(experiment.controlMetrics, treatment);
  const artifact = `experiment:${experiment.id} ${summary}`;
  log.info({ id: experiment.id, verdict, summary }, '[experiment] Experiment judged');

  try {
    if (verdict === 'improved') {
      await prisma.promptEvolution.create({
        data: {
          status: 'proposed',
          basePromptKey: `workflow_role_${experiment.role}`,
          afterPrompt: experiment.addendum,
          improvement: experiment.addendum.split('\n')[0]?.slice(0, 200) ?? '',
          category: experiment.role,
          performanceDelta: treatment.criticPassRate - experiment.controlMetrics.criticPassRate,
          reason: `実験 ${experiment.id} で効果実証 (仮説#${experiment.hypothesisId}): ${summary}`,
          evidenceJson: JSON.stringify({
            experimentId: experiment.id,
            hypothesisId: experiment.hypothesisId,
            statement: experiment.statement,
            control: experiment.controlMetrics,
            treatment,
            treatmentTaskIds: experiment.treatmentTaskIds,
          }),
        },
      });
      await addEvidence(experiment.hypothesisId, {
        stance: 'for',
        detail: `対照実験で改善を実証: ${summary}`,
        artifact,
        phase: 'experiment',
        decisive: true,
      }).catch((err) => log.warn({ err }, '[experiment] addEvidence(for) failed'));
      await setHypothesisStatus(experiment.hypothesisId, 'supported').catch(() => false);
      appendExperimentHistory(experiment, 'adopted', treatment);
    } else if (verdict === 'regressed') {
      // Rollback = the clearActiveExperiment above: the intervention never
      // reached 'approved', so from the next task on nothing is injected.
      await addEvidence(experiment.hypothesisId, {
        stance: 'against',
        detail: `対照実験で悪化を確認、介入をロールバック: ${summary}`,
        artifact,
        phase: 'experiment',
        decisive: true,
      }).catch((err) => log.warn({ err }, '[experiment] addEvidence(against) failed'));
      await setHypothesisStatus(experiment.hypothesisId, 'refuted').catch(() => false);
      appendExperimentHistory(experiment, 'rejected', treatment);
    } else {
      // no_diff / insufficient: unproven effect is NOT adopted.
      await addEvidence(experiment.hypothesisId, {
        stance: 'against',
        detail: `対照実験で有意差なし (効果未実証): ${summary}`,
        artifact,
        phase: 'experiment',
        decisive: false,
      }).catch((err) => log.warn({ err }, '[experiment] addEvidence(no_diff) failed'));
      await setHypothesisStatus(experiment.hypothesisId, 'inconclusive').catch(() => false);
      appendExperimentHistory(experiment, 'inconclusive', treatment);
    }
  } catch (err) {
    log.warn({ err, id: experiment.id, verdict }, '[experiment] Settlement failed');
    appendExperimentHistory(experiment, 'aborted', treatment);
  }
  return verdict;
}

/**
 * Manually abort the active experiment (no judgement, no hypothesis update).
 *
 * @returns True when an experiment was aborted. / 中断できたか
 */
export function abortExperiment(): boolean {
  const experiment = readActiveExperiment();
  if (!experiment) return false;
  clearActiveExperiment();
  appendExperimentHistory(experiment, 'aborted', null);
  log.info({ id: experiment.id }, '[experiment] Experiment aborted manually');
  return true;
}
