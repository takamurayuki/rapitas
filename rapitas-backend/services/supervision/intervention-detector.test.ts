/**
 * intervention-detector tests
 *
 * Detection of operator-driven transitions and gate violations, and the durable
 * fail-closed write path: a failed write stays pending across a simulated restart
 * and is not cleared by an unrelated later success.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTimelineFake } from './testing/timeline-fake';

const dataDir = mkdtempSync(join(tmpdir(), 'supervision-intervention-'));
process.env.RAPITAS_DATA_DIR = dataDir;

type Transition = { id: number; taskId: number; actor: string; cause: string; createdAt: Date };
const transitions: Transition[] = [];
let failScan = false;

const fake = createTimelineFake();
mock.module('../memory/timeline', () => fake.module);
mock.module('../../config/database', () => ({
  prisma: {
    workflowTransition: {
      findMany: async (args: {
        where: {
          createdAt: { gte: Date };
          OR: Array<{ actor?: { in: string[] }; cause?: { startsWith?: string; in?: string[] } }>;
        };
      }) => {
        if (failScan) throw new Error('db down');
        return transitions.filter(
          (t) =>
            t.createdAt >= args.where.createdAt.gte &&
            args.where.OR.some(
              (c) =>
                (c.actor && c.actor.in.includes(t.actor)) ||
                (c.cause?.startsWith && t.cause.startsWith(c.cause.startsWith)) ||
                (c.cause?.in && c.cause.in.includes(t.cause)),
            ),
        );
      },
    },
  },
}));

const detector = await import('./intervention-detector');
const { readSpool } = await import('./supervision-write-spool');

const SINCE = new Date('2026-09-01T00:00:00Z');

beforeEach(() => {
  fake.rows.length = 0;
  transitions.length = 0;
  failScan = false;
  rmSync(join(dataDir, 'supervision'), { recursive: true, force: true });
  detector.resetInterventionWriteFailure();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('syncInterventionsFromTransitions', () => {
  test('records a user-driven transition once (idempotent)', async () => {
    transitions.push({
      id: 11,
      taskId: 5,
      actor: 'user',
      cause: 'file_saved:plan',
      createdAt: new Date('2026-09-05T00:00:00Z'),
    });
    expect(await detector.syncInterventionsFromTransitions(SINCE)).toBe(1);
    expect(await detector.syncInterventionsFromTransitions(SINCE)).toBe(0);
    const [rec] = await detector.listInterventions(SINCE);
    expect(rec.sourceKind).toBe('workflow_transition_user');
    expect(rec.workflowTransitionId).toBe(11);
    expect(rec.detectedAt).toBe('2026-09-05T00:00:00.000Z');
  });

  test('automation-only transitions are not interventions', async () => {
    transitions.push(
      {
        id: 1,
        taskId: 5,
        actor: 'system',
        cause: 'auto_advance',
        createdAt: new Date('2026-09-05T00:00:00Z'),
      },
      {
        id: 2,
        taskId: 5,
        actor: 'verifier',
        cause: 'verify_repair',
        createdAt: new Date('2026-09-05T00:00:00Z'),
      },
    );
    expect(await detector.syncInterventionsFromTransitions(SINCE)).toBe(0);
    expect(await detector.listInterventions(SINCE)).toEqual([]);
  });

  test('manual causes recorded under a system actor are still interventions', async () => {
    transitions.push({
      id: 3,
      taskId: 6,
      actor: 'system',
      cause: 'task_retried',
      createdAt: new Date('2026-09-05T00:00:00Z'),
    });
    await detector.syncInterventionsFromTransitions(SINCE);
    expect((await detector.listInterventions(SINCE))[0].sourceKind).toBe('manual_retry');
  });

  test('a failed scan is unmet until a later scan succeeds', async () => {
    failScan = true;
    await detector.syncInterventionsFromTransitions(SINCE);
    expect(detector.hasInterventionWriteFailure()).toBe(true);
    failScan = false;
    await detector.syncInterventionsFromTransitions(SINCE);
    expect(detector.hasInterventionWriteFailure()).toBe(false);
  });
});

describe('recordCompletionGateViolation', () => {
  test('records a completion-gate violation', async () => {
    expect(await detector.recordCompletionGateViolation(9, 'no_changes_unjustified')).toBe(true);
    const [rec] = await detector.listInterventions(SINCE);
    expect(rec.sourceKind).toBe('completion_gate_violation');
    expect(rec.taskId).toBe(9);
  });
});

describe('durable write failure', () => {
  test('spooled failure survives restart and an unrelated success; cleared only by persisting it', async () => {
    const detectedAt = new Date('2026-09-06T12:00:00Z');
    fake.failNextAppends(1);
    expect(
      await detector.recordIntervention({
        taskId: 42,
        sourceKind: 'manual_approval',
        note: 'lost',
        detectedAt,
      }),
    ).toBe(false);
    expect(readSpool().records).toHaveLength(1);

    // An unrelated later write succeeding must not clear the pending failure.
    expect(
      await detector.recordIntervention({ taskId: 43, sourceKind: 'manual_retry', note: 'ok' }),
    ).toBe(true);
    expect(detector.hasInterventionWriteFailure()).toBe(true);

    // Simulated restart: in-process state is gone, the spool file is not.
    detector.resetInterventionWriteFailure();
    expect(detector.hasInterventionWriteFailure()).toBe(true);
    expect(detector.getInterventionWriteHealth().pendingSpooled).toBe(1);

    // Retry still failing keeps it pending.
    fake.failNextAppends(1);
    expect(await detector.flushPendingInterventions()).toEqual({ flushed: 0, pending: 1 });
    expect(detector.hasInterventionWriteFailure()).toBe(true);

    expect(await detector.flushPendingInterventions()).toEqual({ flushed: 1, pending: 0 });
    expect(detector.hasInterventionWriteFailure()).toBe(false);
    const recovered = (await detector.listInterventions(SINCE)).find((r) => r.taskId === 42);
    expect(recovered?.detectedAt).toBe(detectedAt.toISOString());
  });
});
