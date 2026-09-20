/**
 * guard-incident-filer test
 *
 * Verifies NDJSON guard incidents become one concern per (task, kind) with a fixed dedup key.
 */
import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileGuardIncidents, type GuardIncidentSubmit } from './guard-incident-filer';

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
