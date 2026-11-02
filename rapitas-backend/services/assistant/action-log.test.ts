/**
 * action-log.test
 *
 * What the audit log has to guarantee: it records an act that is declared,
 * it refuses one that is not, and it never turns a storage problem into a
 * failed request — the act already happened by then.
 */
import { describe, expect, test, beforeEach, mock } from 'bun:test';

/** Rows the recorder tried to write. */
let created: Record<string, unknown>[] = [];
/** When set, the stand-in store throws instead of accepting the row. */
let storageFails = false;

mock.module('../../config/database', () => ({
  prisma: {
    assistantAction: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (storageFails) throw new Error('disk on fire');
        created.push(data);
        return { id: created.length };
      },
      findMany: async (args: Record<string, unknown>) => {
        created.push({ __findMany: args });
        return [];
      },
    },
  },
  ensureDatabaseConnection: async () => {},
}));

const { recordAction, listRecentActions } = await import('./action-log');
const { UnknownCapabilityError } = await import('./capabilities');

beforeEach(() => {
  created = [];
  storageFails = false;
});

describe('recordAction', () => {
  test('writes a row for a declared capability', async () => {
    const id = await recordAction({ capabilityId: 'task.draft', status: 'proposed' });
    expect(id).toBe(1);
    expect(created[0]).toMatchObject({ capabilityId: 'task.draft', status: 'proposed' });
  });

  test('stores what the act carried, as JSON text', async () => {
    await recordAction({
      capabilityId: 'task.create',
      status: 'executed',
      args: { title: 'アバターを直す' },
      taskId: 7,
    });
    expect(created[0].argumentsJson).toBe(JSON.stringify({ title: 'アバターを直す' }));
    expect(created[0].taskId).toBe(7);
  });

  test('records a refusal, which leaves no other trace', async () => {
    await recordAction({
      capabilityId: 'task.create',
      status: 'refused',
      errorMessage: 'not confirmed',
    });
    expect(created[0]).toMatchObject({ status: 'refused', errorMessage: 'not confirmed' });
  });

  // The thing that keeps the registry honest: the log cannot drift into
  // recording operations nobody declared.
  test('refuses a capability the registry does not declare', async () => {
    await expect(
      // @ts-expect-error — the runtime guard is the point
      recordAction({ capabilityId: 'theme.delete', status: 'executed' }),
    ).rejects.toBeInstanceOf(UnknownCapabilityError);
    expect(created).toEqual([]);
  });

  // The act already happened; losing its row must not fail the request.
  test('survives the store being broken', async () => {
    storageFails = true;
    const id = await recordAction({ capabilityId: 'task.draft', status: 'proposed' });
    expect(id).toBeNull();
  });

  test('keeps the row when the arguments cannot be serialised', async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const id = await recordAction({
      capabilityId: 'task.draft',
      status: 'proposed',
      args: circular,
    });
    expect(id).toBe(1);
    expect(created[0].argumentsJson).toBeUndefined();
  });
});

describe('listRecentActions', () => {
  test('is newest first', async () => {
    await listRecentActions();
    expect(created[0].__findMany).toMatchObject({ orderBy: { createdAt: 'desc' } });
  });

  test('caps how much can be asked for at once', async () => {
    await listRecentActions(10_000);
    expect((created[0].__findMany as { take: number }).take).toBe(100);
  });

  test('never takes less than one', async () => {
    await listRecentActions(0);
    expect((created[0].__findMany as { take: number }).take).toBe(1);
  });
});
