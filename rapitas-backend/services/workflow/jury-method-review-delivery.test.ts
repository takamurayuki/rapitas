/**
 * jury-method-review-delivery.test
 *
 * Task 1547 R2: after two jury bounces on the same criterion and kind, the
 * third bounce reason carries a method-review sentence. It must reach the
 * implementer, not be stopped by the non-convergence cutoff first; the bounce
 * after that is cut off as before. Drives the real attemptVerifyRepair and
 * detectRepairNonConvergence (mocks copied from verify-self-repair.test.ts).
 */
import { describe, expect, test, mock, beforeEach } from 'bun:test';
import type { ReviewFinding } from '../agents/verification/review-findings';
import { buildJuryRepairReason } from './jury-repair-reason';

const CRITERIA = ['否定の文を矛盾判定に数えない', 'b', 'c', 'd', 'e', 'f'];
const taskRow = () => ({
  status: 'in-progress',
  workflowStatus: 'in_progress',
  updatedAt: new Date('2026-11-25T00:00:00Z'),
  themeId: null,
  acceptanceCriteria: JSON.stringify(CRITERIA),
});

const noopLogger = { info: () => {}, warn: mock(() => {}), error: () => {}, debug: () => {} };
let priorRows: { metadata: string | null }[] = [];

const mockPrisma = {
  userSettings: { findFirst: mock(() => Promise.resolve({ verifyRepairLimit: 10 })) },
  activityLog: { findFirst: mock(() => Promise.resolve(null)) },
  workflowTransition: {
    count: mock(() => Promise.resolve(2)),
    findFirst: mock(() => Promise.resolve(null)),
    findMany: mock(() => Promise.resolve(priorRows)),
  },
  task: {
    updateMany: mock(() => Promise.resolve({ count: 1 })),
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(async () => taskRow()),
  },
  workflowFile: { findFirst: mock(() => Promise.resolve(null)) },
};
const readWorkflowFile = mock(() => Promise.resolve(''));
const writeWorkflowFile = mock((..._a: unknown[]) => Promise.resolve());
const recordTransition = mock((_t: { cause?: string; metadata?: { reason?: string } }) =>
  Promise.resolve(),
);
Object.assign(mockPrisma, {
  $transaction: async (operation: (tx: typeof mockPrisma) => unknown) => operation(mockPrisma),
  agentExecution: { findFirst: async () => null },
  themeAutoRun: { findFirst: async () => null },
});
Object.assign(mockPrisma, { workflowFileVersion: { create: async () => undefined } });
Object.assign(mockPrisma.workflowFile, {
  findUnique: (args: { where: { taskId_fileType: { fileType: string } } }) =>
    args.where.taskId_fileType.fileType === 'plan'
      ? mockPrisma.workflowFile.findFirst()
      : Promise.resolve(null),
  upsert: (args: { create: { taskId: number; content: string } }) =>
    writeWorkflowFile(args.create.taskId, 'verify', args.create.content),
});
Object.assign(mockPrisma.workflowTransition, {
  create: async (args: { data: { metadata: string } }) =>
    recordTransition({ ...args.data, metadata: JSON.parse(args.data.metadata) }),
});

mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile, writeWorkflowFile }));
mock.module('./transition-recorder', () => ({ recordTransition }));
mock.module('./auto-run/theme-auto-run-service', () => ({
  isThemeAutoRunActive: () => Promise.resolve(true),
}));
mock.module('./blocked-task-escalation', () => ({
  escalateBlockedTask: mock(() => Promise.resolve(true)),
  BLOCKED_ESCALATED_CAUSE: 'blocked_escalated',
  countEscalatedBlocked: () => Promise.resolve(0),
}));
mock.module('./verify-repair-queue', () => ({
  enqueueCommittedRepair: mock(async () => 'scheduler_owned'),
}));

const { attemptVerifyRepair } = await import('./verify-self-repair');

const finding: ReviewFinding = {
  severity: 'major',
  summary: '否定の取りこぼし',
  criterion: '受入基準1',
  evidence: 'bounce-reason-classifier.ts:48',
  gating: true,
  kind: 'input_coverage',
};
const HEADLINE = '受入基準1: [major] 否定の取りこぼし（根拠: bounce-reason-classifier.ts:48）';
const plain = buildJuryRepairReason({ reasons: [HEADLINE], findings: [finding] }, []);
const third = buildJuryRepairReason({ reasons: [HEADLINE], findings: [finding] }, [
  [finding],
  [finding],
]);
const row = (reason: string) => ({
  metadata: JSON.stringify({ reason, findings: [finding] }),
});
const causes = () => recordTransition.mock.calls.map((c) => c[0].cause);

beforeEach(() => {
  recordTransition.mockClear();
  writeWorkflowFile.mockClear();
});

describe('method review reaches the implementer (task 1547 R2)', () => {
  test('3 回目の方式見直し文が実装者に届く', async () => {
    expect(third).toContain('方式の見直し: ');
    priorRows = [row(plain), row(plain)];
    const result = await attemptVerifyRepair(1547, 'in_progress', third, '# verify');
    expect(result.bounced).toBe(true);
    const bounce = recordTransition.mock.calls.find((c) => c[0].cause === 'verify_repair');
    expect(bounce?.[0].metadata?.reason).toContain('方式の見直し: ');
    const written = writeWorkflowFile.mock.calls.map((c) => String(c[2])).join('\n');
    expect(written).toContain('方式の見直し: ');
  });

  test('4 回目（過去に方式見直し文あり）は従来どおり打ち切られる', async () => {
    priorRows = [row(plain), row(third)];
    const result = await attemptVerifyRepair(1547, 'in_progress', third, '# verify');
    expect(result.bounced).toBe(false);
    expect(causes()).toContain('verify_repair_non_convergence');
    expect(causes()).not.toContain('verify_repair');
  });

  test('方式見直し文の無い 3 回目は従来どおり打ち切られる', async () => {
    priorRows = [row(plain), row(plain)];
    const result = await attemptVerifyRepair(1547, 'in_progress', plain, '# verify');
    expect(result.bounced).toBe(false);
    expect(causes()).toContain('verify_repair_non_convergence');
  });
});
