/**
 * ai-orchestra.awaiting-ci.test
 *
 * The session's completed count follows the same rule as the queue's: an item
 * handed back for a CI wait is not a completion (task 1570).
 */
import { expect, mock, test } from 'bun:test';

const noopLog = { info() {}, warn() {}, error() {}, debug() {} };
mock.module('../../config', () => ({
  prisma: {
    orchestraSession: {
      findUnique: async () => ({
        id: 3,
        status: 'conducting',
        totalTasks: 2,
        startedAt: null,
      }),
    },
  },
  createLogger: () => noopLog,
  logger: noopLog,
}));
mock.module('../../config/logger', () => ({ createLogger: () => noopLog }));

const items = [
  { id: 1, status: 'completed', currentPhase: 'verify_done' },
  { id: 2, status: 'completed', currentPhase: 'awaiting_ci' },
];
mock.module('./workflow-queue', () => ({
  WorkflowQueueService: {
    getInstance: () => ({
      getSessionItems: async () => items,
      getQueueState: async () => ({
        queued: [],
        running: [],
        waitingApproval: [],
        completed: [items[0]],
        failed: [],
      }),
    }),
  },
}));
mock.module('./workflow-runner', () => ({
  WorkflowRunner: {
    getInstance: () => ({
      getStatus: () => ({ isRunning: false, activeItems: 0, processedTotal: 0 }),
    }),
  },
}));
mock.module('../communication/realtime-service', () => ({
  realtimeService: { broadcast() {} },
}));

const { AIOrchestra } = await import('./ai-orchestra');

test('does not count a CI-wait item as a completed session task', async () => {
  const orchestra = AIOrchestra.getInstance();
  (orchestra as unknown as { currentSessionId: number }).currentSessionId = 3;

  const state = await orchestra.getState();

  expect(state.session?.completedTasks).toBe(1);
  expect(state.queue.completed).toBe(1);
});
