/**
 * Shared automated verification gate tests.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockPrisma = {
  task: {
    update: mock(() => Promise.resolve({})),
  },
  agentSession: {
    update: mock(() => Promise.resolve({})),
  },
};

let verifierMode: 'pass' | 'fail' | 'throw' = 'pass';

mock.module('../../config/database', () => ({ prisma: mockPrisma }));
mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));
mock.module('../../services/agents/verification/automated-verifier', () => ({
  runAutomatedVerification: mock(async (_worktreePath: string) => {
    if (verifierMode === 'throw') throw new Error('tool crashed');
    if (verifierMode === 'fail') {
      return {
        ok: false,
        changedFiles: ['src/broken.ts'],
        checks: [
          {
            name: 'typecheck',
            ran: true,
            ok: false,
            errorCount: 1,
            details: 'TS2322: Type string is not assignable to number',
          },
        ],
        summary: '1 new typecheck error in src/broken.ts',
      };
    }
    return {
      ok: true,
      changedFiles: ['src/ok.ts'],
      checks: [{ name: 'lint', ran: true, ok: true, errorCount: 0, details: '' }],
      summary: 'verification passed',
    };
  }),
  renderVerificationMarkdown: (result: { summary: string }) => `# Verification\n\n${result.summary}`,
}));

const { runVerificationGate } = await import('../../services/agents/verification/verification-gate');

function resetMockFunctions(value: unknown): void {
  if (typeof value === 'function' && 'mockReset' in value) {
    (value as ReturnType<typeof mock>).mockReset();
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) resetMockFunctions(child);
  }
}

describe('runVerificationGate', () => {
  beforeEach(() => {
    resetMockFunctions(mockPrisma);
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.agentSession.update.mockResolvedValue({});
    verifierMode = 'pass';
  });

  test('opens the gate when automated verification passes', async () => {
    const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

    expect(outcome.ok).toBe(true);
    expect(outcome.result?.summary).toBe('verification passed');
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
  });

  test('blocks the task and fails the session when verification finds new failures', async () => {
    verifierMode = 'fail';

    const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

    expect(outcome.ok).toBe(false);
    expect(outcome.result?.summary).toContain('typecheck error');
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'blocked' }),
    });
    expect(mockPrisma.agentSession.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('1 new typecheck error'),
      }),
    });
  });

  test('opens the gate if the verifier itself crashes', async () => {
    verifierMode = 'throw';

    const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

    expect(outcome).toEqual({ ok: true, result: null });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
  });
});
