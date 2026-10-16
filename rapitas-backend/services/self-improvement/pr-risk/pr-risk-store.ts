/**
 * pr-risk-store
 *
 * Persistence for PR-risk prediction through a narrow `PrRiskDb` interface
 * (only the delegates this feature uses). Owns config defaults and the
 * score↔outcome join. NOT responsible for scoring or metric arithmetic.
 */
import { prisma } from '../../../config/database';
import {
  DEFAULT_STAGE,
  DEFAULT_THRESHOLD,
  toStage,
  type FeatureVector,
  type LabelledPrediction,
  type PrRiskConfigValue,
  type TrainingRow,
} from './pr-risk-types';
import type { OutcomeRow } from './pr-risk-outcome';
import type {
  ConfigRow,
  MetricRow,
  OutcomeDbRow,
  PrRiskDb,
  ReviewRow,
  ScoreRow,
} from './pr-risk-db';

export type { PrRiskDb } from './pr-risk-db';

// NOTE: Cast through unknown on purpose — the generated Prisma client only
// gains these delegates after the user restarts the server (prisma generate is
// never run by agents), and tests inject an in-memory PrRiskDb. A name drift
// against pr-risk.prisma is caught by pr-risk-schema-drift.test.ts.
export const defaultDb = prisma as unknown as PrRiskDb;

const CONFIG_ID = 1;

/**
 * Read the rollout config; a missing row means defaults (stage off).
 *
 * @param db - Database / DB
 * @returns Config value / 設定
 */
export async function readConfig(db: PrRiskDb = defaultDb): Promise<PrRiskConfigValue> {
  const row = await db.prRiskConfig.findUnique({ where: { id: CONFIG_ID } });
  if (!row) {
    return {
      stage: DEFAULT_STAGE,
      threshold: DEFAULT_THRESHOLD,
      modelJson: null,
      modelVersion: 0,
      stageChangedAt: null,
    };
  }
  return {
    stage: toStage(row.stage) ?? DEFAULT_STAGE,
    threshold: row.threshold,
    modelJson: row.modelJson,
    modelVersion: row.modelVersion,
    stageChangedAt: row.stageChangedAt,
  };
}

/**
 * Patch the config row (created with defaults on first write).
 *
 * @param db - Database / DB
 * @param patch - Fields to change / 変更内容
 * @returns The resulting config / 更新後の設定
 */
export async function writeConfig(
  db: PrRiskDb,
  patch: Partial<Omit<ConfigRow, 'id'>>,
): Promise<PrRiskConfigValue> {
  const current = await readConfig(db);
  await db.prRiskConfig.upsert({
    where: { id: CONFIG_ID },
    create: { id: CONFIG_ID, ...current, ...patch },
    update: patch,
  });
  return readConfig(db);
}

/**
 * Register a PR for outcome tracking without clobbering an existing label.
 *
 * @param db - Database / DB
 * @param repo - owner/repo / リポジトリ
 * @param prNumber - PR number / PR番号
 */
export async function ensureOutcomeTracked(
  db: PrRiskDb,
  repo: string,
  prNumber: number,
): Promise<void> {
  await db.prOutcome.upsert({
    where: { repo_prNumber: { repo, prNumber } },
    create: { repo, prNumber, label: 'pending' },
    update: {},
  });
}

/**
 * Persist a (re)classified outcome.
 *
 * @param db - Database / DB
 * @param row - Classified outcome / 判定結果
 * @param labeledAt - When the label was computed / 判定時刻
 */
export async function upsertOutcome(db: PrRiskDb, row: OutcomeRow, labeledAt: Date): Promise<void> {
  const data = {
    mergeSha: row.mergeSha,
    mergedAt: row.mergedAt,
    label: row.label,
    failureKind: row.failureKind,
    revertSha: row.revertSha,
    revertAt: row.revertAt,
    labeledAt: row.label === 'pending' ? null : labeledAt,
  };
  await db.prOutcome.upsert({
    where: { repo_prNumber: { repo: row.repo, prNumber: row.prNumber } },
    create: { repo: row.repo, prNumber: row.prNumber, ...data },
    update: data,
  });
}

/** Outcomes still worth re-checking: pending, or incidents lacking merge info. */
export async function listUnsettledOutcomes(db: PrRiskDb): Promise<OutcomeDbRow[]> {
  return db.prOutcome.findMany({
    where: { OR: [{ label: 'pending' }, { failureKind: 'critical_incident', mergedAt: null }] },
  });
}

interface Joined {
  outcome: OutcomeDbRow;
  score: ScoreRow;
}

/**
 * Pair each settled outcome with its latest score (closest to merge).
 *
 * @param outcomes - Settled outcomes / 確定済み結果
 * @param scores - All scores for those PRs / 対象PRのスコア
 * @returns Joined pairs; outcomes without a score are dropped / 結合結果
 */
export function joinLatestScores(outcomes: OutcomeDbRow[], scores: ScoreRow[]): Joined[] {
  const latest = new Map<string, ScoreRow>();
  for (const s of scores) {
    const key = `${s.repo}#${s.prNumber}`;
    const prev = latest.get(key);
    if (!prev || s.createdAt.getTime() > prev.createdAt.getTime()) latest.set(key, s);
  }
  return outcomes.flatMap((o) => {
    const score = latest.get(`${o.repo}#${o.prNumber}`);
    return score && (o.label === 'failure' || o.label === 'success') ? [{ outcome: o, score }] : [];
  });
}

async function settledJoined(db: PrRiskDb, mergedFrom?: Date, mergedTo?: Date): Promise<Joined[]> {
  const mergedAt = mergedFrom && mergedTo ? { gte: mergedFrom, lt: mergedTo } : undefined;
  const outcomes = await db.prOutcome.findMany({
    where: { label: { in: ['failure', 'success'] }, ...(mergedAt ? { mergedAt } : {}) },
  });
  if (outcomes.length === 0) return [];
  const scores = await db.prRiskScore.findMany({
    where: { OR: outcomes.map((o) => ({ repo: o.repo, prNumber: o.prNumber })) },
  });
  return joinLatestScores(outcomes, scores);
}

/**
 * Labelled predictions for PRs merged in [from, to).
 *
 * @param db - Database / DB
 * @param from - Inclusive start / 開始
 * @param to - Exclusive end / 終了
 * @returns Predictions with their final label / 確定ラベル付き予測
 */
export async function listLabelledPredictions(
  db: PrRiskDb,
  from: Date,
  to: Date,
): Promise<LabelledPrediction[]> {
  return (await settledJoined(db, from, to)).map(({ outcome, score }) => ({
    score: score.score,
    thresholdUsed: score.thresholdUsed,
    label: outcome.label as 'failure' | 'success',
  }));
}

/**
 * All settled PRs as training rows.
 *
 * @param db - Database / DB
 * @returns Feature vectors with labels / 学習データ
 */
export async function listTrainingRows(db: PrRiskDb): Promise<TrainingRow[]> {
  return (await settledJoined(db)).map(({ outcome, score }) => ({
    features: JSON.parse(score.featuresJson) as FeatureVector,
    label: outcome.label as 'failure' | 'success',
  }));
}

/** Score already computed for this exact head SHA, if any. */
export async function findScore(
  db: PrRiskDb,
  repo: string,
  prNumber: number,
  headSha: string,
): Promise<ScoreRow | null> {
  return db.prRiskScore.findUnique({
    where: { repo_prNumber_headSha: { repo, prNumber, headSha } },
  });
}

/** Persist a new score row. */
export async function createScore(
  db: PrRiskDb,
  data: Omit<ScoreRow, 'id' | 'createdAt'>,
): Promise<ScoreRow> {
  return db.prRiskScore.create({ data });
}

/** Stamp the comment time on a score row. */
export async function markCommentPosted(db: PrRiskDb, id: number, at: Date): Promise<void> {
  await db.prRiskScore.update({ where: { id }, data: { commentPostedAt: at } });
}

/** Month's metric row, if already recorded. */
export async function findMonthlyMetric(db: PrRiskDb, month: string): Promise<MetricRow | null> {
  return db.prRiskMonthlyMetric.findUnique({ where: { month } });
}

/** Record (idempotently, keyed by month) a monthly metric row. */
export async function upsertMonthlyMetric(db: PrRiskDb, row: MetricRow): Promise<void> {
  await db.prRiskMonthlyMetric.upsert({ where: { month: row.month }, create: row, update: row });
}

/** Append a threshold-review audit row. */
export async function createThresholdReview(db: PrRiskDb, row: ReviewRow): Promise<void> {
  await db.prRiskThresholdReview.create({ data: row });
}

/**
 * Register an operator-confirmed critical production incident for a PR
 * (the only non-rollback failure source — never inferred).
 *
 * @param db - Database / DB
 * @param p - repo, prNumber, note, now / 登録内容
 */
export async function registerIncident(
  db: PrRiskDb,
  p: { repo: string; prNumber: number; note: string; now: Date },
): Promise<void> {
  const data = {
    label: 'failure',
    failureKind: 'critical_incident',
    incidentNote: p.note,
    labeledAt: p.now,
  };
  await db.prOutcome.upsert({
    where: { repo_prNumber: { repo: p.repo, prNumber: p.prNumber } },
    create: { repo: p.repo, prNumber: p.prNumber, ...data },
    update: data,
  });
}

/** Last 12 monthly metric rows and last 12 threshold reviews, newest first. */
export async function listRecentMetrics(
  db: PrRiskDb,
): Promise<{ metrics: MetricRow[]; reviews: ReviewRow[] }> {
  const [metrics, reviews] = await Promise.all([
    db.prRiskMonthlyMetric.findMany({ orderBy: { month: 'desc' }, take: 12 }),
    db.prRiskThresholdReview.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }),
  ]);
  return { metrics, reviews };
}
