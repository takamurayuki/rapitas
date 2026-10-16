/**
 * pr-risk-db
 *
 * Row shapes and the narrow `PrRiskDb` interface (only the Prisma delegates
 * PR-risk prediction uses). Types only — access helpers live in pr-risk-store.
 */
import type { MonthlyMetric } from './pr-risk-metrics';

export interface ConfigRow {
  id: number;
  stage: string;
  threshold: number;
  modelJson: string | null;
  modelVersion: number;
  stageChangedAt: Date | null;
}

export interface ScoreRow {
  id: number;
  repo: string;
  prNumber: number;
  headSha: string;
  taskId: number | null;
  score: number;
  baseLogit: number;
  featuresJson: string;
  contributionsJson: string;
  thresholdUsed: number;
  stage: string;
  modelVersion: number;
  held: boolean;
  commentPostedAt: Date | null;
  createdAt: Date;
}

export interface OutcomeDbRow {
  repo: string;
  prNumber: number;
  mergeSha: string | null;
  mergedAt: Date | null;
  label: string;
  failureKind: string | null;
  revertSha?: string | null;
  revertAt?: Date | null;
  incidentNote: string | null;
  labeledAt?: Date | null;
}

export interface MetricRow extends MonthlyMetric {
  month: string;
  threshold: number;
  modelVersion: number;
  createdAt?: Date;
}

export interface ReviewRow {
  month: string;
  previousThreshold: number;
  proposedThreshold: number | null;
  adopted: boolean;
  reason: string;
  sample: number;
  createdAt?: Date;
}

type Where = Record<string, unknown>;
type FindMany = { where?: Where; orderBy?: Record<string, 'asc' | 'desc'>; take?: number };

/** The Prisma delegates this feature needs (names pinned by the drift test). */
export interface PrRiskDb {
  prRiskConfig: {
    findUnique(a: { where: { id: number } }): Promise<ConfigRow | null>;
    upsert(a: {
      where: { id: number };
      create: ConfigRow;
      update: Partial<ConfigRow>;
    }): Promise<ConfigRow>;
  };
  prRiskScore: {
    findUnique(a: {
      where: { repo_prNumber_headSha: { repo: string; prNumber: number; headSha: string } };
    }): Promise<ScoreRow | null>;
    create(a: { data: Omit<ScoreRow, 'id' | 'createdAt'> }): Promise<ScoreRow>;
    update(a: { where: { id: number }; data: Partial<ScoreRow> }): Promise<ScoreRow>;
    findMany(a: FindMany): Promise<ScoreRow[]>;
  };
  prOutcome: {
    upsert(a: {
      where: { repo_prNumber: { repo: string; prNumber: number } };
      create: Partial<OutcomeDbRow> & { repo: string; prNumber: number };
      update: Where;
    }): Promise<unknown>;
    findMany(a: FindMany): Promise<OutcomeDbRow[]>;
  };
  prRiskMonthlyMetric: {
    findUnique(a: { where: { month: string } }): Promise<MetricRow | null>;
    upsert(a: {
      where: { month: string };
      create: MetricRow;
      update: Partial<MetricRow>;
    }): Promise<MetricRow>;
    findMany(a: FindMany): Promise<MetricRow[]>;
  };
  prRiskThresholdReview: {
    create(a: { data: ReviewRow }): Promise<unknown>;
    findMany(a: FindMany): Promise<ReviewRow[]>;
  };
}
