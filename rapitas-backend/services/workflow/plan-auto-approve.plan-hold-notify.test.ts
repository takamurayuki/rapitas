/**
 * plan-auto-approve.plan-hold-notify.test
 *
 * A withheld plan (forbidden-change hold) must tell a human once: the stagnation
 * detector now treats the hold as a legitimate wait (task #1205), so the notice is
 * the only visibility. Re-saves must not re-notify; notify failure must not alter
 * the recorded hold or the return value.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

let latestCause: string | null = null;
let notifyThrows = false;
const notifications: Array<Record<string, unknown>> = [];

mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: {
      findFirst: async (args: { where: { cause?: unknown } }) => {
        // isManualPlanApprovalHeld filters by cause; the "previous cause" lookup does not.
        if (args.where.cause !== undefined) return null;
        return latestCause === null ? null : { cause: latestCause };
      },
    },
    userSettings: { findFirst: () => Promise.resolve({ autoApprovePlan: true }) },
    task: {
      findUnique: () =>
        Promise.resolve({
          autoApprovePlan: true,
          parentId: null,
          workflowStatus: 'plan_created',
          status: 'todo',
          updatedAt: new Date(0),
          themeId: 7,
          title: 'held task',
        }),
      updateMany: () => Promise.resolve({ count: 1 }),
    },
  },
}));

mock.module('./forbidden-change-plan-hold', () => ({
  PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE: 'plan_forbidden_change_hold',
  resolveForbiddenChangePlanHold: async () => ({
    paths: ['rapitas-backend/prisma/schema/task.prisma'],
    instruction: 'POST approve-plan に overrideForbiddenChange:true を付けて承認してください。',
  }),
}));

const recordedTransitions: Array<Record<string, unknown>> = [];
mock.module('./transition-recorder', () => ({
  recordTransition: (input: Record<string, unknown>) => {
    recordedTransitions.push(input);
    return Promise.resolve();
  },
}));

mock.module('./auto-run/auto-run-notifications-shared', () => ({
  notifyOnce: async (params: Record<string, unknown>) => {
    if (notifyThrows) throw new Error('notify failed');
    notifications.push(params);
  },
  taskLabel: async () => 'held task',
}));

const { maybeAutoApprovePlan } = await import('./plan-auto-approve');

beforeEach(() => {
  latestCause = null;
  notifyThrows = false;
  notifications.length = 0;
  recordedTransitions.length = 0;
});

describe('maybeAutoApprovePlan: forbidden-change hold notification (#1205)', () => {
  test('first hold records the transition and notifies once', async () => {
    latestCause = 'phase_completed:planner';
    const result = await maybeAutoApprovePlan(1205, 'ja', { autoAdvance: false });
    expect(result).toEqual({ newStatus: 'plan_created', autoApproved: false });
    expect(recordedTransitions).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(notifications[0].taskId).toBe(1205);
    expect(notifications[0].themeId).toBe(7);
    expect(String(notifications[0].message)).toContain('overrideForbiddenChange');
  });

  test('a repeated hold (newest cause already the hold) does not re-notify', async () => {
    latestCause = 'plan_forbidden_change_hold';
    await maybeAutoApprovePlan(1205, 'ja', { autoAdvance: false });
    expect(recordedTransitions).toHaveLength(1);
    expect(notifications).toHaveLength(0);
  });

  test('a notification failure never changes the hold or the result', async () => {
    notifyThrows = true;
    const result = await maybeAutoApprovePlan(1205, 'ja', { autoAdvance: false });
    expect(result).toEqual({ newStatus: 'plan_created', autoApproved: false });
    expect(recordedTransitions).toHaveLength(1);
  });
});
