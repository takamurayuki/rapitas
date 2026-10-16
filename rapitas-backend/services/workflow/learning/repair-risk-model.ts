/**
 * repair-risk-model
 *
 * Pure bucket model for the repair-risk predictor: turns recorded phase runs
 * into a (complexity × input length × stream) → bounce-rate table and
 * classifies a new run against it. No DB access — see repair-risk-inputs.
 *
 * NOTE: a counted-rate table with a sample floor, not a fitted model. The
 * history is too thin for 36 cells to support a regression without overfitting,
 * and this matches the repo's other learners (role-evidence, prompt-evolution).
 */
import { ROLE_TROUBLE_CAUSES } from '../role-evidence';
import {
  COMPLEXITY_LOW_MAX,
  COMPLEXITY_MID_MAX,
  PRIOR_ROLES,
  REPAIR_RISK_PHASE_MAP,
  REPAIR_RISK_STREAMS,
  type ComplexityBucket,
  type InputLengthBucket,
  type RepairRiskStream,
} from './repair-risk-constants';

/** Transition columns the model reads. */
export interface RepairRiskTransitionRow {
  taskId: number;
  cause: string;
  phase: string | null;
  createdAt: Date;
}

/** One recorded context_section_metrics event, flattened. */
export interface ContextMetricRow {
  taskId: number;
  role: string;
  totalChars: number;
  createdAt: Date;
}

/** Per-task facts needed to place a run in a cell. */
export interface RepairRiskTaskFacts {
  complexityScore: number | null;
  descriptionChars: number;
}

/** One training observation: a stream that ran for a task. */
export interface RepairRiskSample {
  taskId: number;
  stream: RepairRiskStream;
  complexityScore: number | null;
  inputChars: number;
  repaired: boolean;
}

/** Counted cell. */
export interface RepairRiskCell {
  sampleSize: number;
  repairRate: number;
}

export type RepairRiskTable = Map<string, RepairRiskCell>;

/** Classification of one run. */
export interface RepairRiskClassification {
  risk: 'high' | 'low' | 'indeterminate';
  bucketKey: string | null;
  sampleSize: number;
  repairRate: number;
}

/**
 * Band a complexity score.
 *
 * @param score - Task.complexityScore (0-100) or null. / 複雑度スコア
 * @returns Band, or null when the score is not decided yet. / 複雑度帯（未確定はnull）
 */
export function classifyComplexity(score: number | null | undefined): ComplexityBucket | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score <= COMPLEXITY_LOW_MAX) return 'low';
  if (score <= COMPLEXITY_MID_MAX) return 'mid';
  return 'high';
}

/**
 * Band an input length.
 *
 * @param chars - Character count. / 文字数
 * @param bounds - Inclusive short max / long min. / 帯の境界
 * @returns Input-length band. / 入力長帯
 */
export function classifyInputLength(
  chars: number,
  bounds: { shortMax: number; longMin: number },
): InputLengthBucket {
  if (chars <= bounds.shortMax) return 'short';
  if (chars >= bounds.longMin) return 'long';
  return 'medium';
}

/**
 * Stable cell key.
 *
 * @param complexity - Complexity band. / 複雑度帯
 * @param input - Input-length band. / 入力長帯
 * @param stream - Phase. / 実行段階
 * @returns Key string. / セルキー
 */
export function bucketKey(
  complexity: ComplexityBucket,
  input: InputLengthBucket,
  stream: RepairRiskStream,
): string {
  return `${complexity}|${input}|${stream}`;
}

/**
 * Map a recorded role name to its stream.
 *
 * @param role - Role label (researcher / planner / ...). / ロール名
 * @returns Stream, or null for roles the model does not track. / 実行段階
 */
export function streamForRole(role: string): RepairRiskStream | null {
  for (const stream of REPAIR_RISK_STREAMS) {
    if (REPAIR_RISK_PHASE_MAP[stream].includes(role)) return stream;
  }
  return null;
}

/**
 * Causes that count as a bounce of a stream, derived from ROLE_TROUBLE_CAUSES
 * so the definition of "failure" never drifts from role-evidence.
 *
 * @param stream - Phase. / 実行段階
 * @returns Cause codes. / 差し戻し原因コード
 */
export function troubleCausesFor(stream: RepairRiskStream): Set<string> {
  const causes = new Set<string>();
  for (const role of REPAIR_RISK_PHASE_MAP[stream]) {
    for (const cause of ROLE_TROUBLE_CAUSES[role] ?? []) causes.add(cause);
  }
  return causes;
}

/** Every cause that counts as a bounce of any stream. */
export function allTroubleCauses(): Set<string> {
  const causes = new Set<string>();
  for (const stream of REPAIR_RISK_STREAMS) {
    for (const cause of troubleCausesFor(stream)) causes.add(cause);
  }
  return causes;
}

/**
 * Input length a stream is judged on: the task description for research, the
 * latest recorded context size of the preferred prior role otherwise.
 *
 * @param stream - Phase being judged. / 判定対象の段階
 * @param descriptionChars - Task description length. / タスク説明の文字数
 * @param metrics - This task's metric rows (any order). / 当該タスクの計測行
 * @returns Measured length, or null when the prior phase was never measured. / 実測値（無ければnull）
 */
export function measuredInputChars(
  stream: RepairRiskStream,
  descriptionChars: number,
  metrics: ContextMetricRow[],
): number | null {
  if (stream === 'research') return descriptionChars;
  for (const role of PRIOR_ROLES[stream]) {
    let latest: ContextMetricRow | null = null;
    for (const m of metrics) {
      if (m.role !== role) continue;
      if (!latest || m.createdAt.getTime() > latest.createdAt.getTime()) latest = m;
    }
    if (latest) return latest.totalChars;
  }
  return null;
}

/**
 * Build training samples: one per (task, stream) that has a recorded run.
 * A run whose input length cannot be measured is dropped — the description
 * fallback is for inference only, never for training.
 *
 * @param transitions - Workflow transitions in the window. / 遷移履歴
 * @param metrics - context_section_metrics rows in the window. / 計測イベント
 * @param facts - Per-task complexity / description length. / タスク属性
 * @returns Samples. / 学習サンプル
 */
export function buildRepairRiskSamples(
  transitions: RepairRiskTransitionRow[],
  metrics: ContextMetricRow[],
  facts: Map<number, RepairRiskTaskFacts>,
): RepairRiskSample[] {
  const metricsByTask = new Map<number, ContextMetricRow[]>();
  const ranStreams = new Map<number, Set<RepairRiskStream>>();
  for (const m of metrics) {
    const stream = streamForRole(m.role);
    if (!stream) continue;
    const list = metricsByTask.get(m.taskId) ?? [];
    list.push(m);
    metricsByTask.set(m.taskId, list);
    const ran = ranStreams.get(m.taskId) ?? new Set<RepairRiskStream>();
    ran.add(stream);
    ranStreams.set(m.taskId, ran);
  }

  const bouncedByTask = new Map<number, Set<RepairRiskStream>>();
  const causeStreams = REPAIR_RISK_STREAMS.map((s) => [s, troubleCausesFor(s)] as const);
  for (const t of transitions) {
    // Rows without a phase cannot be placed on the phase axis.
    if (t.phase === null) continue;
    for (const [stream, causes] of causeStreams) {
      if (!causes.has(t.cause)) continue;
      const set = bouncedByTask.get(t.taskId) ?? new Set<RepairRiskStream>();
      set.add(stream);
      bouncedByTask.set(t.taskId, set);
    }
  }

  const samples: RepairRiskSample[] = [];
  for (const [taskId, streams] of ranStreams) {
    const fact = facts.get(taskId);
    if (!fact) continue;
    for (const stream of streams) {
      const chars = measuredInputChars(stream, fact.descriptionChars, metricsByTask.get(taskId)!);
      if (chars === null) continue;
      samples.push({
        taskId,
        stream,
        complexityScore: fact.complexityScore,
        inputChars: chars,
        repaired: bouncedByTask.get(taskId)?.has(stream) ?? false,
      });
    }
  }
  return samples;
}

/**
 * Count samples into cells.
 *
 * @param samples - Training samples. / 学習サンプル
 * @param bounds - Input-length band bounds. / 入力長帯の境界
 * @returns Cell table. / セル表
 */
export function computeRepairRiskBuckets(
  samples: RepairRiskSample[],
  bounds: { shortMax: number; longMin: number },
): RepairRiskTable {
  const counts = new Map<string, { n: number; bad: number }>();
  for (const s of samples) {
    const complexity = classifyComplexity(s.complexityScore);
    if (!complexity) continue;
    const key = bucketKey(complexity, classifyInputLength(s.inputChars, bounds), s.stream);
    const c = counts.get(key) ?? { n: 0, bad: 0 };
    c.n += 1;
    if (s.repaired) c.bad += 1;
    counts.set(key, c);
  }
  const table: RepairRiskTable = new Map();
  for (const [key, c] of counts) {
    table.set(key, { sampleSize: c.n, repairRate: c.n > 0 ? c.bad / c.n : 0 });
  }
  return table;
}

/**
 * Classify a cell. Below the sample floor the answer is `indeterminate`, never
 * `high` — a thin cell's rate is noise.
 *
 * @param key - Cell key, or null when a feature is missing. / セルキー
 * @param table - Cell table. / セル表
 * @param opts - Sample floor and high-risk threshold. / 判定パラメータ
 * @returns Classification. / 判定結果
 */
export function classifyRisk(
  key: string | null,
  table: RepairRiskTable,
  opts: { minSamples: number; threshold: number },
): RepairRiskClassification {
  const cell = key ? table.get(key) : undefined;
  if (!key || !cell || cell.sampleSize < opts.minSamples) {
    return {
      risk: 'indeterminate',
      bucketKey: key,
      sampleSize: cell?.sampleSize ?? 0,
      repairRate: cell?.repairRate ?? 0,
    };
  }
  return {
    risk: cell.repairRate >= opts.threshold ? 'high' : 'low',
    bucketKey: key,
    sampleSize: cell.sampleSize,
    repairRate: cell.repairRate,
  };
}
