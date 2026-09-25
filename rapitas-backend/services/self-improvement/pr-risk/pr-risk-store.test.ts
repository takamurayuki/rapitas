/**
 * pr-risk-store test
 *
 * Pins config defaults (stage off when no row), config patching, outcome
 * tracking that never clobbers an existing label, and the score↔outcome join
 * that feeds monthly metrics (latest score per PR, settled labels only).
 */
import { describe, it, expect } from 'bun:test';
import {
  readConfig,
  writeConfig,
  ensureOutcomeTracked,
  upsertOutcome,
  listUnsettledOutcomes,
  listLabelledPredictions,
  listTrainingRows,
  createScore,
} from './pr-risk-store';
import { createFakeDb } from './pr-risk-fake-db.test-helpers';

const features = {
  file_size: 1,
  files_changed: 1,
  author: 0,
  dependency_change: 0,
  schema_change: 0,
};
const scoreData = (prNumber: number, score: number) => ({
  repo: 'o/r',
  prNumber,
  headSha: `h${prNumber}-${score}`,
  taskId: 1,
  score,
  baseLogit: -2.2,
  featuresJson: JSON.stringify(features),
  contributionsJson: '[]',
  thresholdUsed: 0.5,
  stage: 'display',
  modelVersion: 0,
  held: false,
  commentPostedAt: null,
});

describe('config', () => {
  it('defaults to stage off / threshold 0.5 / untrained when no row exists', async () => {
    const { db } = createFakeDb();
    expect(await readConfig(db)).toEqual({
      stage: 'off',
      threshold: 0.5,
      modelJson: null,
      modelVersion: 0,
      stageChangedAt: null,
    });
  });

  it('patches the single row and keeps untouched fields', async () => {
    const { db, tables } = createFakeDb();
    await writeConfig(db, { stage: 'display' });
    const after = await writeConfig(db, { threshold: 0.7 });
    expect(after).toMatchObject({ stage: 'display', threshold: 0.7, modelVersion: 0 });
    expect(tables.prRiskConfig.rows).toHaveLength(1);
  });

  it('falls back to off for an unknown stored stage', async () => {
    const { db } = createFakeDb();
    await writeConfig(db, { stage: 'bogus' });
    expect((await readConfig(db)).stage).toBe('off');
  });
});

describe('outcomes', () => {
  it('ensureOutcomeTracked never overwrites an existing label', async () => {
    const { db, tables } = createFakeDb();
    await upsertOutcome(
      db,
      {
        repo: 'o/r',
        prNumber: 1,
        mergeSha: 'm',
        mergedAt: new Date('2026-08-01T00:00:00Z'),
        label: 'failure',
        failureKind: 'rollback_72h',
        revertSha: 'r',
        revertAt: new Date('2026-08-02T00:00:00Z'),
      },
      new Date(),
    );
    await ensureOutcomeTracked(db, 'o/r', 1);
    await ensureOutcomeTracked(db, 'o/r', 2);
    expect(tables.prOutcome.rows[0]).toMatchObject({ prNumber: 1, label: 'failure' });
    expect(tables.prOutcome.rows[1]).toMatchObject({ prNumber: 2, label: 'pending' });
    const unsettled = await listUnsettledOutcomes(db);
    expect(unsettled.map((o) => o.prNumber)).toEqual([2]);
  });
});

describe('labelled predictions', () => {
  it('joins the latest score per PR and only settled labels in the month', async () => {
    const { db, tables } = createFakeDb();
    const old = await createScore(db, scoreData(1, 0.2));
    old.createdAt = new Date('2026-08-01T00:00:00Z');
    const latest = await createScore(db, scoreData(1, 0.9));
    latest.createdAt = new Date('2026-08-02T00:00:00Z');
    await createScore(db, scoreData(2, 0.1));
    await createScore(db, scoreData(3, 0.1));
    const mk = (prNumber: number, label: 'failure' | 'success' | 'pending', mergedAt: string) =>
      upsertOutcome(
        db,
        {
          repo: 'o/r',
          prNumber,
          mergeSha: null,
          mergedAt: new Date(mergedAt),
          label,
          failureKind: label === 'failure' ? 'rollback_72h' : null,
          revertSha: null,
          revertAt: null,
        },
        new Date(),
      );
    await mk(1, 'failure', '2026-08-10T00:00:00Z');
    await mk(2, 'success', '2026-08-20T00:00:00Z');
    await mk(3, 'pending', '2026-08-25T00:00:00Z');
    await mk(4, 'success', '2026-09-01T00:00:00Z'); // other month, no score
    expect(tables.prOutcome.rows).toHaveLength(4);

    const rows = await listLabelledPredictions(
      db,
      new Date('2026-08-01T00:00:00Z'),
      new Date('2026-09-01T00:00:00Z'),
    );
    expect(rows).toEqual([
      { score: 0.9, thresholdUsed: 0.5, label: 'failure' },
      { score: 0.1, thresholdUsed: 0.5, label: 'success' },
    ]);

    const training = await listTrainingRows(db);
    expect(training).toHaveLength(2);
    expect(training[0]).toEqual({ features, label: 'failure' });
  });
});
