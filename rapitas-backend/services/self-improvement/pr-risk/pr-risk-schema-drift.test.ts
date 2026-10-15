/**
 * pr-risk-schema-drift test
 *
 * `PrRiskDb` is bound to the Prisma client through an `unknown` cast (the
 * generated client lags until a server restart), so the compiler cannot catch
 * a model/field rename. This test pins every model and field the feature uses
 * against the text of prisma/schema/pr-risk.prisma.
 */
import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = readFileSync(
  path.join(import.meta.dir, '..', '..', '..', 'prisma', 'schema', 'pr-risk.prisma'),
  'utf8',
);

const EXPECTED: Record<string, string[]> = {
  PrRiskConfig: [
    'id',
    'stage',
    'threshold',
    'modelJson',
    'modelVersion',
    'stageChangedAt',
    'updatedAt',
  ],
  PrRiskScore: [
    'id',
    'repo',
    'prNumber',
    'headSha',
    'taskId',
    'score',
    'baseLogit',
    'featuresJson',
    'contributionsJson',
    'thresholdUsed',
    'stage',
    'modelVersion',
    'held',
    'commentPostedAt',
    'createdAt',
  ],
  PrOutcome: [
    'id',
    'repo',
    'prNumber',
    'mergeSha',
    'mergedAt',
    'label',
    'failureKind',
    'revertSha',
    'revertAt',
    'incidentNote',
    'labeledAt',
    'updatedAt',
  ],
  PrRiskMonthlyMetric: [
    'id',
    'month',
    'sample',
    'tp',
    'fp',
    'fn',
    'tn',
    'precision',
    'recall',
    'fpr',
    'threshold',
    'modelVersion',
    'createdAt',
  ],
  PrRiskThresholdReview: [
    'id',
    'month',
    'previousThreshold',
    'proposedThreshold',
    'adopted',
    'reason',
    'sample',
    'createdAt',
  ],
};

function modelFields(model: string): string[] | null {
  const m = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(SCHEMA);
  if (!m) return null;
  return m[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[a-zA-Z]/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

describe('pr-risk.prisma ↔ PrRiskDb', () => {
  for (const [model, fields] of Object.entries(EXPECTED)) {
    it(`${model} declares every field the store uses`, () => {
      const actual = modelFields(model);
      expect(actual).not.toBeNull();
      for (const f of fields) expect(actual).toContain(f);
    });
  }

  it('declares the composite unique keys the store queries by', () => {
    expect(SCHEMA).toContain('@@unique([repo, prNumber, headSha])'); // repo_prNumber_headSha
    expect(SCHEMA).toContain('@@unique([repo, prNumber])'); // repo_prNumber
    expect(SCHEMA).toMatch(/month\s+String\s+@unique/);
  });
});
