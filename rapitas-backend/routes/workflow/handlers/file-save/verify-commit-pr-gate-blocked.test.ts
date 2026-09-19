/**
 * verify-commit-pr-gate-blocked tests — a gate failure whose signature equals
 * the last verify_repair bounce holds (blocked + diagnosis) instead of
 * re-running the implementer; a different failure still bounces.
 */
import { beforeEach, expect, mock, test } from 'bun:test';

let priorTransition: { metadata: string; createdAt: Date } | null = null;
mock.module('../../../../config', () => ({
  prisma: {
    workflowTransition: { findFirst: () => Promise.resolve(priorTransition) },
    task: { updateMany: () => Promise.resolve({ count: 1 }) },
  },
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));
const recorded: Array<Record<string, unknown>> = [];
mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: (t: Record<string, unknown>) => {
    recorded.push(t);
    return Promise.resolve();
  },
}));
const failed: string[] = [];
mock.module('./shared', () => ({
  markLatestExecutionFailed: (_id: number, msg: string) => {
    failed.push(msg);
    return Promise.resolve();
  },
}));
const blockedWrites: number[] = [];
mock.module('../../../../services/workflow/durable-blocked-write', () => ({
  writeBlockedStatusDurable: (o: { taskId: number }) => {
    blockedWrites.push(o.taskId);
    return Promise.resolve(true);
  },
}));
mock.module('../../../../services/workflow/verify-self-repair-budget', () => ({
  resolveRepairWindowStart: () => Promise.resolve(null),
}));
const repairCalls: string[] = [];
mock.module('../../../../services/workflow/verify-self-repair', () => ({
  attemptVerifyRepair: (_id: number, _s: string, reason: string) => {
    repairCalls.push(reason);
    return Promise.resolve({ bounced: true, newStatus: 'plan_approved', attempt: 2 });
  },
}));

const { handleVerifyGateBlocked, gateFailureSignature, findRepeatedGateFailure } =
  await import('./verify-commit-pr-gate-blocked');

const REASON =
  '自動検証に失敗しました（自動検証: lint=ok / typecheck=ok / test=ok / format=ok / runtime=UNVERIFIED）。ローカルコミットは保持し、push/PR を中止してタスクをブロックしました。';

beforeEach(() => {
  recorded.length = 0;
  failed.length = 0;
  blockedWrites.length = 0;
  repairCalls.length = 0;
});

test('signature strips the prose around the check summary', () => {
  expect(gateFailureSignature(REASON)).toBe(
    '自動検証: lint=ok / typecheck=ok / test=ok / format=ok / runtime=UNVERIFIED',
  );
  expect(gateFailureSignature('plain reason')).toBe('plain reason');
});

test('same signature as the last bounce → hold: blocked + diagnosis, no implementer re-run', async () => {
  priorTransition = {
    metadata: JSON.stringify({ attempt: 1, max: 10, reason: REASON }),
    createdAt: new Date('2026-09-13T12:00:00Z'),
  };
  expect(await findRepeatedGateFailure(912, REASON)).toMatchObject({ attempt: 1 });
  const out = await handleVerifyGateBlocked({
    taskId: 912,
    gateReason: REASON,
    gateRecoveryBlocked: null,
    savedContent: '# verify',
  });
  expect(out).toEqual({});
  expect(repairCalls).toEqual([]);
  expect(blockedWrites).toEqual([912]);
  expect(failed).toEqual([REASON]);
  expect(recorded[0]).toMatchObject({
    taskId: 912,
    cause: 'verification_gate_repeat_hold',
    metadata: { priorAttempt: 1 },
  });
});

test('a different failure than the last bounce still goes to self-repair', async () => {
  priorTransition = {
    metadata: JSON.stringify({ attempt: 1, reason: '自動検証に失敗しました（lint=NG(2)）。' }),
    createdAt: new Date(),
  };
  const out = await handleVerifyGateBlocked({
    taskId: 912,
    gateReason: REASON,
    gateRecoveryBlocked: null,
    savedContent: '# verify',
  });
  expect(repairCalls).toEqual([REASON]);
  expect(out).toEqual({ newStatus: 'plan_approved' });
  expect(blockedWrites).toEqual([]);
});

test('no prior bounce → self-repair as before', async () => {
  priorTransition = null;
  await handleVerifyGateBlocked({
    taskId: 912,
    gateReason: REASON,
    gateRecoveryBlocked: null,
    savedContent: '# verify',
  });
  expect(repairCalls).toEqual([REASON]);
});
