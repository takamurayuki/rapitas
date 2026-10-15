import { expect, test } from 'bun:test';
import { mkdtemp, readdir, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAuxCliRecovery, inspectAuxCliRecovery } from './aux-cli-recovery';
import {
  canReconcileOwnership,
  createOwnershipRegistry,
  STALE_INTENT_MS,
  type OwnershipRecord,
} from './aux-cli-ownership';
import { ClaudeCliUnavailableError } from './cli-errors';

const record: OwnershipRecord = {
  executionToken: 'owned',
  ownershipScope: 'windows-job',
  status: 'unresolved',
  root: { pid: 41, birth: 'windows:1000', pgid: null },
  descendants: [{ pid: 42, birth: 'windows:1001', pgid: null }],
  fullyEnumerated: false,
};

test('Linux scope observation failure cannot discharge absent process identities', async () => {
  const linux: OwnershipRecord = {
    ...record,
    ownershipScope: 'linux-cgroup',
    linuxScope: {
      path: '/sys/fs/cgroup/delegated/rapitas-aux-owned',
      boot: 'boot',
      device: '1',
      inode: '2',
    },
  };
  for (const state of [
    { kind: 'unknown' as const, reason: 'permission denied' },
    { kind: 'present' as const, populated: true },
  ]) {
    const evidence = await inspectAuxCliRecovery(linux, {
      process: async () => ({ kind: 'absent' }),
      job: async () => {
        throw new Error('Windows scope must not be queried');
      },
      linuxScope: async () => state,
    });
    expect(canReconcileOwnership(linux, evidence)).toBe(false);
  }
});

test('missing job cannot discharge an unknown or still-live recorded child', async () => {
  for (const actual of [
    { kind: 'unknown' as const, reason: 'permission' },
    { kind: 'present' as const, identity: record.descendants[0] },
  ]) {
    const evidence = await inspectAuxCliRecovery(record, {
      process: async (pid) => (pid === 41 ? { kind: 'absent' } : actual),
      job: async () => ({ kind: 'absent' }),
    });
    expect(canReconcileOwnership(record, evidence)).toBe(false);
  }
});

test('unknown job query and legacy or unconfirmed records remain blocking', async () => {
  for (const row of [record, { ...record, ownershipScope: undefined }, { ...record, root: null }]) {
    const evidence = await inspectAuxCliRecovery(row, {
      process: async () => ({ kind: 'absent' }),
      job: async () => ({ kind: 'unknown', reason: 'query failed' }),
    });
    expect(canReconcileOwnership(row, evidence)).toBe(false);
  }
});

test('concurrent recovery shares observation and retries unresolved evidence on the next call', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapitas-aux-recovery-'));
  try {
    const registry = createOwnershipRegistry(join(directory, 'registry.json'));
    await registry.recordLaunchIntent(record.executionToken, 'windows-job');
    await registry.confirmOwnership(record.executionToken, record.root!);
    let observations = 0;
    let scopeEmpty = false;
    const recovery = createAuxCliRecovery(registry, async (row) => {
      observations++;
      return {
        fullyEnumerated: true,
        scopeEmpty,
        observations: [{ expected: row.root!, actual: { kind: 'absent' } }],
      };
    });
    const first = recovery.assertReady();
    expect(recovery.assertReady()).toBe(first);
    await expect(first).rejects.toThrow('recovery pending');
    await expect(first).rejects.toBeInstanceOf(ClaudeCliUnavailableError);
    await expect(first).rejects.toHaveProperty('name', 'ClaudeCliUnavailableError');
    expect(observations).toBe(1);
    expect(await registry.snapshot()).toHaveLength(1);
    scopeEmpty = true;
    await recovery.assertReady();
    expect(observations).toBe(2);
    expect(await registry.snapshot()).toEqual([]);
  } finally {
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  }
});

test('recovery in another process leaves a young intent confirmable by its launcher', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapitas-aux-recovery-'));
  try {
    const path = join(directory, 'registry.json');
    const launcher = createOwnershipRegistry(path);
    await launcher.recordLaunchIntent('launching', 'windows-job');
    // A second backend process has its own (empty) liveTokens for this token.
    const other = createAuxCliRecovery(createOwnershipRegistry(path), async () => {
      throw new Error('inspect() must not be called for a root:null record');
    });
    // A launch still inside its confirm window is not an unresolved hold.
    await other.assertReady();
    await launcher.confirmOwnership('launching', record.root!);
    expect((await launcher.snapshot())[0]!.status).toBe('active');
  } finally {
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  }
});

test('an unconfirmed intent is ignored while young and aged out once stale', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapitas-aux-recovery-'));
  try {
    const registry = createOwnershipRegistry(join(directory, 'registry.json'));
    await registry.recordLaunchIntent('crashed', 'windows-job');
    const recorded = Date.parse((await registry.snapshot())[0]!.recordedAt!);
    const unreachable = async () => {
      throw new Error('inspect() must not be called for a root:null record');
    };
    const young = createAuxCliRecovery(
      registry,
      unreachable,
      new Set(),
      () => recorded + STALE_INTENT_MS - 1,
    );
    await young.assertReady();
    expect((await registry.snapshot())[0]!.status).toBe('intent');
    const aged = createAuxCliRecovery(
      registry,
      unreachable,
      new Set(),
      () => recorded + STALE_INTENT_MS,
    );
    await aged.assertReady();
    expect(await registry.snapshot()).toEqual([]);
  } finally {
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  }
});

test('a young intent does not hide an older unresolved hold', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rapitas-aux-recovery-'));
  try {
    const registry = createOwnershipRegistry(join(directory, 'registry.json'));
    await registry.recordLaunchIntent('held', 'windows-job');
    await registry.confirmOwnership('held', record.root!);
    await registry.recordLaunchIntent('launching', 'windows-job');
    const recovery = createAuxCliRecovery(registry, async (row) => ({
      fullyEnumerated: true,
      scopeEmpty: false,
      observations: [{ expected: row.root!, actual: { kind: 'absent' } }],
    }));
    const failure = await recovery.assertReady().catch((error: Error) => error);
    expect(failure).toBeInstanceOf(ClaudeCliUnavailableError);
    expect((failure as Error).message).toContain('held');
    expect((failure as Error).message).not.toContain('launching');
  } finally {
    for (const name of await readdir(directory)) await unlink(join(directory, name));
    await rmdir(directory);
  }
});
