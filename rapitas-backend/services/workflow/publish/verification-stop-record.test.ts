/**
 * verification-stop-record — write resilience and freshness lookup
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const warnings: string[] = [];
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    debug: () => {},
    warn: (_obj: unknown, msg: string) => warnings.push(msg),
    error: () => {},
  }),
}));

const findTask = mock(async (): Promise<{ workflowStatus: string | null } | null> => null);
const create = mock(async (_args: { data: Record<string, unknown> }) => ({}));
const findFirst = mock(async (): Promise<{ cause: string; createdAt: Date } | null> => null);
mock.module('../../../config', () => ({
  prisma: { task: { findUnique: findTask }, workflowTransition: { create, findFirst } },
}));

const { hasFreshVerificationStop, recordVerificationStop } =
  await import('./verification-stop-record');

const stop = {
  taskId: 5,
  stage: 'post_commit_gate' as const,
  summary: 's'.repeat(3000),
  reason: 'r'.repeat(3000),
  failedChecks: ['runtime'],
  details: [{ name: 'runtime', details: 'd'.repeat(3000) }],
};

beforeEach(() => {
  warnings.length = 0;
  findTask.mockReset().mockResolvedValue({ workflowStatus: 'in_progress' });
  create.mockReset().mockResolvedValue({});
  findFirst.mockReset().mockResolvedValue(null);
});

describe('recordVerificationStop', () => {
  test('repeats the current status and caps every free text at 2000 characters', async () => {
    await recordVerificationStop(stop);

    const data = create.mock.calls[0][0].data;
    expect(data).toMatchObject({ fromStatus: 'in_progress', toStatus: 'in_progress' });
    const meta = JSON.parse(data.metadata as string);
    expect(meta.summary).toHaveLength(2000);
    expect(meta.reason).toHaveLength(2000);
    expect(meta.details[0].details).toHaveLength(2000);
  });

  test('falls back to verify_done when the task has no workflow status', async () => {
    findTask.mockResolvedValue({ workflowStatus: null });

    await recordVerificationStop(stop);

    expect(create.mock.calls[0][0].data.toStatus).toBe('verify_done');
  });

  test('retries a failed write once and leaves a single row', async () => {
    create.mockRejectedValueOnce(new Error('busy'));

    await recordVerificationStop(stop);

    expect(create).toHaveBeenCalledTimes(2);
    expect(warnings).toHaveLength(0);
  });

  test('never throws when both writes fail', async () => {
    create.mockRejectedValue(new Error('down'));

    await expect(recordVerificationStop(stop)).resolves.toBeUndefined();
    expect(warnings).toEqual(['Failed to record the verification stop']);
  });
});

describe('hasFreshVerificationStop', () => {
  const row = (cause: string, ageMs: number) => ({
    cause,
    createdAt: new Date(Date.now() - ageMs),
  });

  test('is true only for a recent stop as the latest transition', async () => {
    findFirst.mockResolvedValueOnce(row('verification_stopped', 60_000));
    expect(await hasFreshVerificationStop(5)).toBe(true);

    findFirst.mockResolvedValueOnce(row('verification_stopped', 31 * 60_000));
    expect(await hasFreshVerificationStop(5)).toBe(false);

    findFirst.mockResolvedValueOnce(row('verify_passed', 1000));
    expect(await hasFreshVerificationStop(5)).toBe(false);

    expect(await hasFreshVerificationStop(5)).toBe(false);
  });

  test('is false, not an exception, when the lookup fails', async () => {
    findFirst.mockRejectedValue(new Error('down'));

    expect(await hasFreshVerificationStop(5)).toBe(false);
    expect(warnings).toEqual(['直近の検証停止履歴を取得できませんでした']);
  });
});
