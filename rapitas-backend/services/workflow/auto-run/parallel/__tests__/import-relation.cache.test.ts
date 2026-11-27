/**
 * import-relation.cache.test
 *
 * 2026-11-27: the parallel check re-read up to 50 planned files per side for
 * every candidate pair on every 12-second selection tick, with no cache. The
 * backend held about 0.8 of a core, and it logged "planned file unreadable"
 * 160 times in two minutes. Reads are now cached for a short time.
 */
import { describe, test, expect } from 'bun:test';
import { createCachedReader } from '../import-relation';

describe('createCachedReader', () => {
  test('reads a file once within the time limit, again after it', async () => {
    let t = 0;
    const calls: string[] = [];
    const read = createCachedReader(
      async (p) => {
        calls.push(p);
        return `src of ${p}`;
      },
      60_000,
      () => t,
    );
    expect(await read('/a.ts')).toBe('src of /a.ts');
    t = 59_000;
    expect(await read('/a.ts')).toBe('src of /a.ts');
    expect(calls).toEqual(['/a.ts']);
    t = 61_000;
    await read('/a.ts');
    expect(calls).toEqual(['/a.ts', '/a.ts']);
  });

  test('an unreadable file is remembered too, so it is not retried every tick', async () => {
    let n = 0;
    const read = createCachedReader(
      async () => {
        n++;
        return null;
      },
      60_000,
      () => 0,
    );
    expect(await read('/missing.ts')).toBeNull();
    expect(await read('/missing.ts')).toBeNull();
    expect(n).toBe(1);
  });

  test('different files are cached separately', async () => {
    const calls: string[] = [];
    const read = createCachedReader(
      async (p) => {
        calls.push(p);
        return p;
      },
      60_000,
      () => 0,
    );
    await read('/a.ts');
    await read('/b.ts');
    await read('/a.ts');
    expect(calls).toEqual(['/a.ts', '/b.ts']);
  });
});
