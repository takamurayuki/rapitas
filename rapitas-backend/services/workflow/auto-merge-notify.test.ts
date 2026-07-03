/**
 * auto-merge-notify.test
 *
 * Unit tests for notify() — the dedup/cooldown gate in front of Notification
 * row creation. Covers: cooldown suppression, fresh notification creation,
 * and the two fire-and-forget .catch() swallow paths (lookup + create failure).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const findFirst = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const create = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;
const mockPrisma = { notification: { findFirst, create } };

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { notify } = await import('./auto-merge-notify');

beforeEach(() => {
  findFirst.mockReset();
  findFirst.mockResolvedValue(null);
  create.mockReset();
  create.mockResolvedValue({});
});

const PARAMS = { taskId: 42, type: 'auto_merge_blocked', title: 't', message: 'm' };

describe('notify', () => {
  it('creates a notification when none exists within the cooldown window', async () => {
    await notify(PARAMS);

    expect(create).toHaveBeenCalledTimes(1);
    const [args] = create.mock.calls[0] as [{ data: Record<string, unknown> }];
    expect(args.data).toMatchObject({
      type: 'auto_merge_blocked',
      title: 't',
      message: 'm',
      link: '/tasks/42',
      metadata: JSON.stringify({ taskId: 42 }),
    });
  });

  it('queries by the same type + link the notification will be created with', async () => {
    await notify(PARAMS);

    const [args] = findFirst.mock.calls[0] as [{ where: Record<string, unknown> }];
    expect(args.where).toMatchObject({ type: 'auto_merge_blocked', link: '/tasks/42' });
  });

  it('bounds the lookup window to roughly the 4-hour cooldown', async () => {
    const before = Date.now();
    await notify(PARAMS);
    const after = Date.now();

    const [args] = findFirst.mock.calls[0] as [{ where: { createdAt: { gte: Date } } }];
    const gteMs = args.where.createdAt.gte.getTime();
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
    expect(gteMs).toBeGreaterThanOrEqual(before - FOUR_HOURS_MS - 1000);
    expect(gteMs).toBeLessThanOrEqual(after - FOUR_HOURS_MS + 1000);
  });

  it('skips creation when a notification already exists within the cooldown', async () => {
    findFirst.mockResolvedValue({ id: 1 });

    await notify(PARAMS);

    expect(create).not.toHaveBeenCalled();
  });

  it('treats a lookup failure as "no existing notification" and still creates', async () => {
    findFirst.mockImplementation(() => Promise.reject(new Error('db down')));

    await expect(notify(PARAMS)).resolves.toBeUndefined();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('never throws when creation itself fails', async () => {
    create.mockImplementation(() => Promise.reject(new Error('write failed')));

    await expect(notify(PARAMS)).resolves.toBeUndefined();
  });

  it('builds the link from the given taskId, not a hardcoded value', async () => {
    await notify({ ...PARAMS, taskId: 999 });

    const [args] = create.mock.calls[0] as [{ data: { link: string; metadata: string } }];
    expect(args.data.link).toBe('/tasks/999');
    expect(args.data.metadata).toBe(JSON.stringify({ taskId: 999 }));
  });
});
