/**
 * supervision-handlers tests
 *
 * The acceptance-status API response carries the landing denominators computed by
 * a real snapshot refresh (landingClassCounts, landingPendingTaskIds,
 * nonQualifyingTaskIds, highSeverityOpenConcerns), and an unreadable status is
 * returned as unmet rather than as a success-shaped body.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  createPrismaFake,
  createTimelineFake,
} from '../../../services/supervision/testing/timeline-fake';

process.env.RAPITAS_DATA_DIR = mkdtempSync(join(tmpdir(), 'supervision-handlers-'));

const NOW = new Date(Date.now() + 5 * 24 * 3_600_000);
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

const fake = createTimelineFake(NOW);
const db = createPrismaFake();
let failQuery = false;
const timelineModule = {
  ...fake.module,
  queryEvents: async (...args: Parameters<typeof fake.module.queryEvents>) => {
    if (failQuery) throw new Error('timeline down');
    return fake.module.queryEvents(...args);
  },
};
mock.module('../../../services/memory/timeline', () => timelineModule);
mock.module('../../../config/database', () => ({ prisma: db.prisma }));
mock.module('../../../services/memory/concern-backlog-service', () => ({
  listConcerns: async () => ({ concerns: [], total: 2 }),
}));

const { handleGetAcceptanceStatus } = await import('./supervision-handlers');
const { refreshAcceptanceSnapshot } = await import('../../../services/supervision');

const ctx = () => ({ query: {}, body: undefined, set: {} as { status?: number | string } });

beforeEach(() => {
  fake.rows.length = 0;
  db.state.transitions.length = 0;
  db.state.tasks.length = 0;
  db.state.pullRequests.length = 0;
  db.state.autoMergePRDefault = true;
  failQuery = false;
});

describe('handleGetAcceptanceStatus', () => {
  test('returns landing denominators from a refreshed snapshot', async () => {
    // Task 1: completed at PR creation, merge still pending.
    db.state.tasks.push({ id: 1, parentId: null, acceptanceCriteria: '["a"]' });
    db.state.transitions.push(
      { taskId: 1, toStatus: 'in_progress', cause: 'verify_passed', createdAt: hoursAgo(5) },
      { taskId: 1, toStatus: 'completed', cause: 'file_saved:verify', createdAt: hoursAgo(4) },
    );
    db.state.pullRequests.push({ linkedTaskId: 1, state: 'open' });
    // Task 2: verified and completed but no acceptance criteria registered.
    db.state.tasks.push({ id: 2, parentId: null, acceptanceCriteria: null });
    db.state.transitions.push(
      { taskId: 2, toStatus: 'in_progress', cause: 'verify_passed', createdAt: hoursAgo(3) },
      { taskId: 2, toStatus: 'completed', cause: 'file_saved:verify', createdAt: hoursAgo(2) },
    );

    const snapshot = await refreshAcceptanceSnapshot({ heartbeatIntervalMs: 60_000, now: NOW });
    expect(snapshot).not.toBeNull();

    const c = ctx();
    const body = (await handleGetAcceptanceStatus(c)) as {
      success: boolean;
      met: boolean;
      reasonCodes: string[];
      denominators: Record<string, unknown>;
    };
    expect(c.set.status).toBeUndefined();
    expect(body.success).toBe(true);
    expect(body.met).toBe(false);
    expect(JSON.parse(String(body.denominators.landingClassCounts))).toMatchObject({
      landing_pending: 1,
      criteria_missing: 1,
      qualified: 0,
    });
    expect(body.denominators.landingPendingTaskIds).toBe('1');
    expect(body.denominators.nonQualifyingTaskIds).toBe('2');
    expect(body.denominators.highSeverityOpenConcerns).toBe(2);
    expect(body.reasonCodes).toContain('landing_evidence_pending');
    expect(body.reasonCodes).toContain('unresolved_high_severity_concern');
  });

  test('an unreadable status is a 500 with met=false, never a success body', async () => {
    failQuery = true;
    const c = ctx();
    const body = (await handleGetAcceptanceStatus(c)) as { success: boolean; met: boolean };
    expect(c.set.status).toBe(500);
    expect(body.success).toBe(false);
    expect(body.met).toBe(false);
  });
});
