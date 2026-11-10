/**
 * session-cost-sweep-cursor.test
 *
 * The sweep position must survive a restart (re-review4 P2), so the file
 * store has to read back what it wrote, and degrade to the start of the ring
 * (never throw) when the file is missing, corrupt or unwritable.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileSweepCursorStore } from './session-cost-sweep-cursor';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-sweep-cursor-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('createFileSweepCursorStore', () => {
  test('a new store instance (a restart) reads the position the previous one wrote', () => {
    const file = join(dir, 'nested', 'cursor');
    expect(createFileSweepCursorStore(file).read()).toBe(0);
    createFileSweepCursorStore(file).write(42);
    expect(createFileSweepCursorStore(file).read()).toBe(42);
  });

  test('a corrupt or negative value restarts at 0', () => {
    const file = join(dir, 'bad');
    for (const content of ['abc', '-3', '1.5', '']) {
      writeFileSync(file, content);
      expect(createFileSweepCursorStore(file).read()).toBe(0);
    }
  });

  test('a failed write does not throw', () => {
    // A path under a regular file cannot be created.
    const blocker = join(dir, 'blocker');
    writeFileSync(blocker, 'x');
    const store = createFileSweepCursorStore(join(blocker, 'cursor'));
    expect(() => store.write(7)).not.toThrow();
    expect(store.read()).toBe(0);
  });

  test('defaults to RAPITAS_DATA_DIR', () => {
    const prev = process.env.RAPITAS_DATA_DIR;
    process.env.RAPITAS_DATA_DIR = join(dir, 'data');
    try {
      createFileSweepCursorStore().write(9);
      expect(createFileSweepCursorStore(join(dir, 'data', '.session-cost-sweep-cursor')).read()).toBe(9);
    } finally {
      if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
      else process.env.RAPITAS_DATA_DIR = prev;
    }
  });
});
