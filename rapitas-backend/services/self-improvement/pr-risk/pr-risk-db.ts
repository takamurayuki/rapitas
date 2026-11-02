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
  /*
   * NOTE: repo+prNumber, repo+prNumber+headSha and month are unique WITHIN a
   * workspace now (`@@unique([workspaceId, ...])`), so none of them is a
   * filter `findUnique` or `upsert` can take — the workspace half of the key
   * is supplied by the scope layer, not by callers. These delegates therefore
   * expose findFirst + create + update, and the store does the find-then-write.
   */
  prRiskScore: {
    findFirst(a: {
      where: { repo: string; prNumber: number; headSha: string };
    }): Promise<ScoreRow | null>;
    create(a: { data: Omit<ScoreRow, 'id' | 'createdAt'> }): Promise<ScoreRow>;
    update(a: { where: { id: number }; data: Partial<ScoreRow> }): Promise<ScoreRow>;
    findMany(a: FindMany): Promise<ScoreRow[]>;
  };
  prOutcome: {
    // Returns the row including its `id`, which is what the find-then-write
    // re-keys the update by. OutcomeDbRow itself does not declare one.
    findFirst(a: {
      where: { repo: string; prNumber: number };
    }): Promise<(OutcomeDbRow & { id: number }) | null>;
    create(a: {
      data: Partial<OutcomeDbRow> & { repo: string; prNumber: number };
    }): Promise<unknown>;
    update(a: { where: { id: number }; data: Where }): Promise<unknown>;
    findMany(a: FindMany): Promise<OutcomeDbRow[]>;
  };
  prRiskMonthlyMetric: {
    findFirst(a: { where: { month: string } }): Promise<(MetricRow & { id: number }) | null>;
    create(a: { data: MetricRow }): Promise<MetricRow>;
    update(a: { where: { id: number }; data: Partial<MetricRow> }): Promise<MetricRow>;
    findMany(a: FindMany): Promise<MetricRow[]>;
  };
  prRiskThresholdReview: {
    create(a: { data: ReviewRow }): Promise<unknown>;
    findMany(a: FindMany): Promise<ReviewRow[]>;
  };
}
