/**
 * acceptance-status-service integration test
 *
 * Restart persistence: a verdict persisted before a restart is served again by a
 * freshly initialised module from the timeline alone, and degrades to
 * snapshot_stale (unmet) once it is too old to be current. Landing is recomputed
 * from the DB on every refresh, so a merge that lands later turns a pending task
 * into a qualified one after a restart.
 */
import { describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPrismaFake, createTimelineFake } from './testing/timeline-fake';

process.env.RAPITAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'supervision-integration-'));

const fake = createTimelineFake();
const db = createPrismaFake();
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({ prisma: db.prisma }));
mock.module('../memory/concern-backlog-service', () => ({
  listConcerns: async () => ({ concerns: [], total: 0 }),
}));

const SNAP_AT = new Date('2026-09-12T00:00:00Z');

describe('acceptance status across a restart', () => {
  test('a re-imported module serves the persisted snapshot, then marks it stale', async () => {
    fake.seed({
      eventType: 'supervision_acceptance_snapshot',
      correlationId: 'supervision_acceptance',
      createdAt: SNAP_AT,
      payload: {
        schemaVersion: 1,
        met: false,
        streakCount: 7,
        streakStartAt: '2026-09-11T00:00:00.000Z',
        hoursSinceLastIntervention: 23.5,
        observedGapMinutes: 12,
        reasonCodes: ['streak_task_count_below_threshold', 'knowledge_reuse_evidence_insufficient'],
        blockingTaskIds: [895],
        evalSetVersion: 'eval-v1',
        denominators: { heartbeatCount: 1400 },
      },
    });

    // A fresh module instance carries no in-process state from before the restart.
    const svc =
      (await import('./acceptance-status-service?restart=1')) as typeof import('./acceptance-status-service');
    const fresh = await svc.readAcceptanceStatus(new Date(SNAP_AT.getTime() + 60_000));
    expect(fresh.streakCount).toBe(7);
    expect(fresh.hoursSinceLastIntervention).toBe(23.5);
    expect(fresh.observedGapMinutes).toBe(12);
    expect(fresh.blockingTaskIds).toEqual([895]);
    expect(fresh.denominators.heartbeatCount).toBe(1400);
    expect(fresh.reasonCodes).not.toContain('snapshot_stale');

    const stale = await svc.readAcceptanceStatus(new Date(SNAP_AT.getTime() + 60 * 60_000));
    expect(stale.met).toBe(false);
    expect(stale.reasonCodes).toContain('snapshot_stale');
  });

  test('with no snapshot at all the status is unmet, not empty success', async () => {
    fake.rows.length = 0;
    const svc = await import('./acceptance-status-service');
    const s = await svc.readAcceptanceStatus();
    expect(s.met).toBe(false);
    expect(s.reasonCodes).toEqual(['no_observation_evidence', 'snapshot_stale']);
  });

  test('a merge that lands after a pending snapshot is qualified after re-initialisation', async () => {
    fake.rows.length = 0;
    const now = new Date(Date.now() + 5 * 24 * 3_600_000);
    const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
    db.state.tasks.push({ id: 700, parentId: null, acceptanceCriteria: '["criterion"]' });
    db.state.transitions.push(
      { taskId: 700, toStatus: 'in_progress', cause: 'verify_passed', createdAt: hoursAgo(3) },
      { taskId: 700, toStatus: 'completed', cause: 'file_saved:verify', createdAt: hoursAgo(2) },
    );
    db.state.pullRequests.push({ linkedTaskId: 700, state: 'open' });

    const before = await import('./acceptance-status-service?landing=before');
    const first = await before.refreshAcceptanceSnapshot({ heartbeatIntervalMs: 60_000, now });
    expect(first?.denominators.landingPendingTaskIds).toBe('700');
    expect(first?.denominators.landingQualifiedTaskIds).toBeNull();

    db.state.transitions.push({
      taskId: 700,
      toStatus: 'completed',
      cause: 'auto_merged',
      createdAt: hoursAgo(1),
    });
    db.state.pullRequests[0].state = 'MERGED';

    // Fresh module instance: nothing cached from the first computation.
    const after = await import('./acceptance-status-service?landing=after');
    const second = await after.refreshAcceptanceSnapshot({ heartbeatIntervalMs: 60_000, now });
    expect(second?.denominators.landingQualifiedTaskIds).toBe('700');
    expect(second?.denominators.landingPendingTaskIds).toBeNull();
    expect(second?.reasonCodes).not.toContain('landing_evidence_pending');
    const persisted = await after.readAcceptanceStatus(now);
    expect(persisted.denominators.landingQualifiedTaskIds).toBe('700');
  });
});
