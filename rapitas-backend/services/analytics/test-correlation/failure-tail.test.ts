import { describe, test, expect } from 'bun:test';
import {
  MAX_FAILURE_TAIL_LINES,
  MAX_FAILURE_TAIL_LINE_CHARS,
  extractFailureTail,
  normalizeFailureTail,
} from './failure-tail';

describe('extractFailureTail', () => {
  test('keeps only the last MAX_FAILURE_TAIL_LINES non-empty lines', () => {
    const text = Array.from({ length: MAX_FAILURE_TAIL_LINES + 5 }, (_, i) => `line ${i}`).join(
      '\n',
    );
    const tail = extractFailureTail(text);
    expect(tail).toHaveLength(MAX_FAILURE_TAIL_LINES);
    expect(tail[tail.length - 1]).toBe(`line ${MAX_FAILURE_TAIL_LINES + 4}`);
  });

  test('returns an empty array for blank output', () => {
    expect(extractFailureTail('  \n\n')).toEqual([]);
  });

  test('truncates overly long lines', () => {
    const tail = extractFailureTail('x'.repeat(MAX_FAILURE_TAIL_LINE_CHARS + 50));
    expect(tail[0]).toHaveLength(MAX_FAILURE_TAIL_LINE_CHARS);
  });
});

describe('normalizeFailureTail', () => {
  test('rejects non-string-array input', () => {
    expect(normalizeFailureTail('x')).toBeUndefined();
    expect(normalizeFailureTail([1, 2])).toBeUndefined();
  });

  test('returns undefined for an empty array and clamps valid input', () => {
    expect(normalizeFailureTail([])).toBeUndefined();
    expect(normalizeFailureTail(['a', 'b'])).toEqual(['a', 'b']);
  });
});
