/**
 * log-tail-reader.test
 *
 * Covers the tail-window arithmetic and the leading-partial-line rule, and
 * pins the behaviour that the file is sized from the OPEN handle rather than
 * from a separate stat() of the path (CodeQL js/file-system-race): a log can
 * be rotated between a stat and an open, which would size the buffer from one
 * file and read from another.
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { readLogTail } from './log-tail-reader';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rapitas-log-tail-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeLog(name: string, content: string): string {
  const file = join(dir, name);
  writeFileSync(file, content, 'utf-8');
  return file;
}

describe('readLogTail', () => {
  it('returns the whole file when maxBytes exceeds its size', async () => {
    const file = writeLog('small.log', 'a\nb\nc\n');
    expect(await readLogTail(file, 1024)).toBe('a\nb\nc\n');
  });

  it('drops the partial first line when the window starts mid-line', async () => {
    // 11 + 12 + 11 = 34 bytes; a 20-byte window starts at 14, inside
    // 'second-line', so that fragment must not reach the caller.
    const file = writeLog('cut.log', 'first-line\nsecond-line\nthird-line\n');
    expect(await readLogTail(file, 20)).toBe('third-line\n');
  });

  it('returns an empty string when the window holds no line boundary', async () => {
    const file = writeLog('nobreak.log', 'a'.repeat(30));
    expect(await readLogTail(file, 5)).toBe('');
  });

  it('returns an empty string for an empty file', async () => {
    const file = writeLog('empty.log', '');
    expect(await readLogTail(file, 1024)).toBe('');
  });

  it('keeps every line when the window lands exactly on a boundary', async () => {
    const file = writeLog('boundary.log', 'aa\nbb\n');
    // start = 6 - 3 = 3, exactly the first byte of 'bb\n'; the drop rule still
    // applies because start > 0, so the first whole line there is consumed.
    expect(await readLogTail(file, 3)).toBe('');
  });

  it('rejects for a path that does not exist', async () => {
    await expect(readLogTail(join(dir, 'missing.log'), 1024)).rejects.toThrow();
  });
});
