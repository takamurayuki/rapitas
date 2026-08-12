/**
 * ExperimentMetrics
 *
 * Pure aggregation and judgement logic for the self-experiment loop: per-task
 * metrics over a window of WorkflowTransition rows (critic pass rate, mean
 * repair count, mean workflow dwell time) and the control-vs-treatment verdict.
 * No I/O, no clock — fixture-testable. Cause vocabulary is imported from
 * retro-evidence so the experiment measures the exact same signals the
 * self-growth ledger counts.
 */
import {
  computePhaseTimings,
  countCauses,
} from '../../workflow/process-retro/retro-evidence';
import type { RetroTransitionRow } from '../../workflow/process-retro/retro-types';
import type { ExperimentMetrics, ExperimentVerdict } from './experiment-types';

/** Default number of completed treatment tasks before judgement. */
export const DEFAULT_TARGET_N = Number(process.env.RAPITAS_EXPERIMENT_TARGET_N ?? '') || 8;

/** Minimum samples per window — below this the verdict is 'insufficient'. */
export const MIN_SAMPLES = Number(process.env.RAPITAS_EXPERIMENT_MIN_SAMPLES ?? '') || 3;

/** Critic-pass-rate margin (fraction) separating improved/regressed from noise. */
export const MARGIN = Number(process.env.RAPITAS_EXPERIMENT_MARGIN ?? '') || 0.1;

/** avgRepair worsening beyond this many bounces per task marks a regression. */
export const REPAIR_WORSE_THRESHOLD = 0.5;

/** Tunables for judgeExperiment (all optional; defaults above). */
export interface JudgeOptions {
  /** Critic-pass-rate margin. / 通過率マージン */
  margin?: number;
  /** Minimum window sample size. / 最小サンプル数 */
  minSamples?: number;
  /** avgRepair worsening threshold. / 修復回数悪化閾値 */
  repairWorseThreshold?: number;
}

/**
 * Aggregate per-task transition rows into window metrics. A task "passes" the
 * critic when it has zero critic-gate bounces; duration is the sum of its
 * phase dwell times (transition-based, NOT AgentExecution.executionTimeMs —
 * that field under-counts interrupted runs).
 *
 * @param rowsByTask - Transition rows grouped by task id. / タスク別遷移行
 * @returns Window metrics (all zeros when the map is empty). / 窓の集計指標
 */
export function computeTaskMetrics(
  rowsByTask: Map<number, RetroTransitionRow[]>,
): ExperimentMetrics {
  const sampleSize = rowsByTask.size;
  if (sampleSize === 0) {
    return { criticPassRate: 0, avgRepair: 0, avgDurationMs: 0, sampleSize: 0 };
  }

  let passed = 0;
  let repairTotal = 0;
  let durationTotal = 0;
  for (const rows of rowsByTask.values()) {
    const counts = countCauses(rows);
    if (counts.criticRebounds === 0) passed++;
    repairTotal += counts.repairCount;
    for (const ms of Object.values(computePhaseTimings(rows))) durationTotal += ms;
  }
  return {
    criticPassRate: passed / sampleSize,
    avgRepair: repairTotal / sampleSize,
    avgDurationMs: durationTotal / sampleSize,
    sampleSize,
  };
}

/**
 * Judge a treatment window against its control window with simple thresholds
 * (deliberately no formal statistics — per task requirements). Regression is
 * checked BEFORE improvement so a pass-rate gain bought with a significant
 * repair-count worsening still counts as regressed.
 *
 * @param control - Control-window metrics. / 対照窓の指標
 * @param treatment - Treatment-window metrics. / 実験窓の指標
 * @param opts - Threshold overrides. / 閾値の上書き
 * @returns Verdict: improved / regressed / no_diff / insufficient. / 判定
 */
export function judgeExperiment(
  control: ExperimentMetrics,
  treatment: ExperimentMetrics,
  opts: JudgeOptions = {},
): ExperimentVerdict {
  const margin = opts.margin ?? MARGIN;
  const minSamples = opts.minSamples ?? MIN_SAMPLES;
  const repairWorseThreshold = opts.repairWorseThreshold ?? REPAIR_WORSE_THRESHOLD;

  if (control.sampleSize < minSamples || treatment.sampleSize < minSamples) {
    return 'insufficient';
  }
  const passRateDiff = treatment.criticPassRate - control.criticPassRate;
  const repairWorsened = treatment.avgRepair > control.avgRepair + repairWorseThreshold;
  if (passRateDiff <= -margin || repairWorsened) return 'regressed';
  if (passRateDiff >= margin) return 'improved';
  return 'no_diff';
}
