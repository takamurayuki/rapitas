/**
 * operation-store tests — append-only NDJSON with masking before write.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createOperationStore } from './operation-store';

const SECRET = 'sk-' + 'Zz9Yy8Xx7Ww6Vv5Uu4Tt3Ss2';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plan-ops-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('operation store', () => {
  test('one tool_use → one NDJSON line, read back in order', () => {
    const store = createOperationStore({ baseDir: dir });
    expect(store.recordToolUse(7, 'Write', { file_path: 'src/a.ts' }, 12)).toBe(1);
    expect(store.recordToolUse(7, 'Read', { file_path: 'src/a.ts' })).toBe(0);
    store.recordToolUse(7, 'Edit', { file_path: 'src/b.ts' });
    const lines = readFileSync(join(dir, 'plan-ops', '7.ndjson'), 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const { operations, warnings } = store.readOperations(7);
    expect(warnings).toEqual([]);
    expect(operations.map((o) => o.seq)).toEqual([1, 2]);
    expect(operations[0]).toMatchObject({
      kind: 'file_change',
      tool: 'Write',
      features: { path: 'src/a.ts' },
      logSequence: 12,
    });
    expect(typeof operations[0].occurredAt).toBe('string');
  });

  test('the stored file never contains the raw secret, but judging features survive', () => {
    const store = createOperationStore({ baseDir: dir });
    store.recordToolUse(8, 'Bash', {
      command: `OPENAI_API_KEY=${SECRET} curl -H "Authorization: Bearer ${SECRET}" https://api.example.com/v1`,
    });
    const raw = readFileSync(join(dir, 'plan-ops', '8.ndjson'), 'utf-8');
    expect(raw).not.toContain(SECRET);
    const { operations } = store.readOperations(8);
    expect(operations.map((o) => o.kind)).toEqual(['command', 'http']);
    expect(operations[0].features.commandNames).toEqual(['curl']);
    expect(operations[1].features.hosts).toEqual(['api.example.com']);
    expect(operations[0].displayMasked).toContain('[REDACTED]');
  });

  test('a secret embedded in a file path is masked in features too', () => {
    const store = createOperationStore({ baseDir: dir });
    store.recordToolUse(9, 'Write', { file_path: `notes/${SECRET}.txt` });
    expect(readFileSync(join(dir, 'plan-ops', '9.ndjson'), 'utf-8')).not.toContain(SECRET);
  });

  test('continues sequence numbers across store instances', () => {
    createOperationStore({ baseDir: dir }).recordToolUse(3, 'Write', { file_path: 'a' });
    createOperationStore({ baseDir: dir }).recordToolUse(3, 'Write', { file_path: 'b' });
    const ops = createOperationStore({ baseDir: dir }).readOperations(3).operations;
    expect(ops.map((o) => o.seq)).toEqual([1, 2]);
  });

  test('stops at the line cap and reports it', () => {
    const store = createOperationStore({ baseDir: dir, maxLines: 2 });
    for (let i = 0; i < 5; i++) store.recordToolUse(4, 'Write', { file_path: `f${i}` });
    const { operations, warnings } = store.readOperations(4);
    expect(operations).toHaveLength(2);
    expect(warnings[0]).toContain('2');
  });

  test('missing file → no operations; corrupt lines are skipped with a warning', () => {
    const store = createOperationStore({ baseDir: dir });
    expect(store.readOperations(99)).toEqual({ operations: [], warnings: [] });
    expect(store.hasOperations(99)).toBe(false);
  });
});
