/**
 * guard-incident-filer test
 *
 * Verifies NDJSON guard incidents become one concern per (task, kind) with a fixed dedup key.
 */
import { describe, test, expect, mock } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The default guard-task lookup reads prisma; every case below injects its own
// lookup, so the client must never be constructed here.
mock.module('../../config/database', () => ({
  prisma: { task: { findUnique: () => Promise.resolve(null) } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { fileGuardIncidents } = await import('./guard-incident-filer');
type GuardIncidentSubmit = import('./guard-incident-filer').GuardIncidentSubmit;

function setup(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'guard-filer-'));
  writeFileSync(
    join(dir, 'guard-incidents-2026-09-20.ndjson'),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n',
  );
  return dir;
}

describe('fileGuardIncidents', () => {
  test('files one concern per task+kind with a fixed dedup key', async () => {
    const dir = setup([
      { ts: 'a', taskId: 907, kind: 'primary_mutation', command: 'cd /c/x && git pull' },
      { ts: 'b', taskId: 907, kind: 'primary_mutation', command: 'cd /c/x && git pull again' },
      { ts: 'c', taskId: 907, kind: 'process_kill', command: 'taskkill /IM bun.exe' },
    ]);
    const calls: Parameters<GuardIncidentSubmit>[0][] = [];
    const filed = await fileGuardIncidents({
      dir,
      submit: async (input) => {
        calls.push(input);
        return { id: calls.length };
      },
    });
    expect(filed).toBe(2);
    expect(calls.map((c) => c.dedupKey).sort()).toEqual([
      'guard-incident:907:primary_mutation',
      'guard-incident:907:process_kill',
    ]);
    expect(calls[0].type).toBe('security');
    expect(calls[0].severity).toBe('high');
    expect(calls[0].originTaskId).toBe(907);
  });

  test('a second pass over the same files files nothing new', async () => {
    const dir = setup([{ ts: 'a', taskId: 5, kind: 'prisma', command: 'prisma generate' }]);
    let n = 0;
    const submit: GuardIncidentSubmit = async () => ({ id: ++n });
    const seen = new Set<string>();
    expect(await fileGuardIncidents({ dir, submit, seen })).toBe(1);
    expect(await fileGuardIncidents({ dir, submit, seen })).toBe(0);
    expect(n).toBe(1);
  });

  test('a restart (fresh in-memory set) does not re-file keys recorded in the sidecar', async () => {
    const dir = setup([{ ts: 'a', taskId: 1006, kind: 'process_kill', command: 'grep "x" f' }]);
    let n = 0;
    const submit: GuardIncidentSubmit = async () => ({ id: ++n });
    expect(await fileGuardIncidents({ dir, submit, seen: new Set() })).toBe(1);
    // New Set = the process restarted and lost processedKeys; the sidecar must carry it.
    expect(await fileGuardIncidents({ dir, submit, seen: new Set() })).toBe(0);
    expect(n).toBe(1);
  });

  test('denials raised by a guard-incident task itself are recorded but never re-filed', async () => {
    const dir = setup([
      {
        ts: 'a',
        taskId: 1016,
        kind: 'process_kill',
        command: "for c in 'grep x f; pkill bun'; do node -e ...",
      },
      { ts: 'b', taskId: 42, kind: 'prisma', command: 'bun run db:prepare:sqlite' },
    ]);
    const calls: Parameters<GuardIncidentSubmit>[0][] = [];
    const filed = await fileGuardIncidents({
      dir,
      submit: async (input) => {
        calls.push(input);
        return { id: calls.length };
      },
      seen: new Set(),
      isGuardTask: async (id) => id === 1016,
    });
    expect(filed).toBe(1);
    expect(calls.map((c) => c.dedupKey)).toEqual(['guard-incident:42:prisma']);
    // The self-referential key is persisted too, so a restart does not revisit it.
    expect(
      await fileGuardIncidents({
        dir,
        submit: async () => ({ id: 9 }),
        seen: new Set(),
        isGuardTask: async () => false,
      }),
    ).toBe(0);
  });

  test('read-only denials (primary_readonly) are recorded but never filed', async () => {
    const dir = setup([
      { ts: 'a', taskId: 1078, kind: 'primary_readonly', command: 'cd /c/x && git worktree list' },
      { ts: 'b', taskId: 1078, kind: 'primary_mutation', command: 'cd /c/x && git pull' },
    ]);
    const calls: Parameters<GuardIncidentSubmit>[0][] = [];
    const filed = await fileGuardIncidents({
      dir,
      submit: async (input) => {
        calls.push(input);
        return { id: calls.length };
      },
      seen: new Set(),
      isGuardTask: async () => false,
    });
    expect(filed).toBe(1);
    expect(calls.map((c) => c.dedupKey)).toEqual(['guard-incident:1078:primary_mutation']);
    // Persisted like a filed key, so a restart does not reconsider it.
    expect(
      await fileGuardIncidents({
        dir,
        submit: async () => ({ id: 9 }),
        seen: new Set(),
        isGuardTask: async () => false,
      }),
    ).toBe(0);
  });

  test('a missing directory is a no-op', async () => {
    expect(
      await fileGuardIncidents({
        dir: join(tmpdir(), 'nope-guard-xyz'),
        submit: async () => ({ id: 1 }),
      }),
    ).toBe(0);
  });

  test('a failed submission is retried on the next pass', async () => {
    const dir = setup([{ ts: 'a', taskId: 1, kind: 'prisma', command: 'x' }]);
    const seen = new Set<string>();
    expect(
      await fileGuardIncidents({
        dir,
        seen,
        submit: async () => {
          throw new Error('db down');
        },
      }),
    ).toBe(0);
    expect(await fileGuardIncidents({ dir, seen, submit: async () => ({ id: 1 }) })).toBe(1);
  });
});
