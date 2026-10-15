/**
 * plan-approval-queue-sync テスト
 *
 * Releases waiting_approval items only for approved plans with no in-flight
 * agent, and fails closed on DB errors.
 */
import { describe, test, expect } from 'bun:test';
import {
  isPlanApprovedStatus,
  isTaskPlanApproved,
  syncQueueAfterPlanApproval,
} from './plan-approval-queue-sync';

type Opts = { status?: string; items?: number; inFlight?: number; fail?: boolean };

function fakeClient(o: Opts) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    task: {
      findUnique: async () => {
        if (o.fail) throw new Error('boom');
        return { workflowStatus: o.status ?? 'plan_approved' };
      },
    },
    workflowQueueItem: {
      findMany: async () => Array.from({ length: o.items ?? 1 }, (_, i) => ({ id: i + 1 })),
      updateMany: async (args: Record<string, unknown>) => {
        updates.push(args);
        return { count: o.items ?? 1 };
      },
    },
    agentExecution: {
      findMany: async () => Array.from({ length: o.inFlight ?? 0 }, (_, i) => ({ id: i + 1 })),
    },
  };
  return { client: client as unknown as Parameters<typeof syncQueueAfterPlanApproval>[1], updates };
}

describe('isPlanApprovedStatus', () => {
  test('plan_created is not approved; later phases are', () => {
    expect(isPlanApprovedStatus('plan_created')).toBe(false);
    expect(isPlanApprovedStatus('plan_approved')).toBe(true);
    expect(isPlanApprovedStatus('in_progress')).toBe(true);
    expect(isPlanApprovedStatus(null)).toBe(false);
  });
});

describe('syncQueueAfterPlanApproval', () => {
  test('approved plan: waiting_approval item becomes queued via CAS', async () => {
    const { client, updates } = fakeClient({});
    expect(await syncQueueAfterPlanApproval(1, client)).toEqual({ released: 1 });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({
      where: { taskId: 1, status: 'waiting_approval' },
      data: { status: 'queued', currentPhase: 'plan_approved' },
    });
  });

  test('plan_created: nothing is written', async () => {
    const { client, updates } = fakeClient({ status: 'plan_created' });
    expect(await syncQueueAfterPlanApproval(1, client)).toEqual({
      released: 0,
      skipped: 'not_approved',
    });
    expect(updates).toHaveLength(0);
  });

  test('in-flight agent: item is not rewritten', async () => {
    const { client, updates } = fakeClient({ inFlight: 1 });
    expect(await syncQueueAfterPlanApproval(1, client)).toEqual({
      released: 0,
      skipped: 'in_flight',
    });
    expect(updates).toHaveLength(0);
  });

  test('no item: no-op', async () => {
    const { client, updates } = fakeClient({ items: 0 });
    expect((await syncQueueAfterPlanApproval(1, client)).skipped).toBe('no_item');
    expect(updates).toHaveLength(0);
  });

  test('DB error: fails closed without throwing', async () => {
    const { client, updates } = fakeClient({ fail: true });
    expect(await isTaskPlanApproved(1, client)).toBe(false);
    expect((await syncQueueAfterPlanApproval(1, client)).skipped).toBe('not_approved');
    expect(updates).toHaveLength(0);
  });
});
