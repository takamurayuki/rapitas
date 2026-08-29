/**
 * workflow-cli-executor-helpers テスト
 *
 * wasVerifyValidationFailureJustRecorded: HTTP保存経路が直近に記録した
 * verify_validation_failed を検知し、CLIエピローグ側の二重記録を防止できるか
 * (task 720 回帰)。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  workflowTransition: {
    findFirst: mock(() => Promise.resolve(null as { cause: string; createdAt: Date } | null)),
  },
};

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { wasVerifyValidationFailureJustRecorded } = await import('./workflow-cli-executor-helpers');

describe('wasVerifyValidationFailureJustRecorded', () => {
  beforeEach(() => {
    mockPrisma.workflowTransition.findFirst.mockReset();
    mockPrisma.workflowTransition.findFirst.mockResolvedValue(null);
  });

  test('直近 transition が verify_validation_failed なら true（HTTP経路の終端ブロックとCLIエピローグの二重記録を防止、task 720 回帰）', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      cause: 'verify_validation_failed',
      createdAt: new Date(),
    });
    expect(await wasVerifyValidationFailureJustRecorded(1)).toBe(true);
  });

  test('直近 transition が別 cause なら false', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      cause: 'verify_repair',
      createdAt: new Date(),
    });
    expect(await wasVerifyValidationFailureJustRecorded(1)).toBe(false);
  });

  test('古い verify_validation_failed（有効期間超過）は false', async () => {
    mockPrisma.workflowTransition.findFirst.mockResolvedValue({
      cause: 'verify_validation_failed',
      createdAt: new Date(Date.now() - 60_000),
    });
    expect(await wasVerifyValidationFailureJustRecorded(1)).toBe(false);
  });

  test('transition が無ければ false', async () => {
    expect(await wasVerifyValidationFailureJustRecorded(1)).toBe(false);
  });
});
