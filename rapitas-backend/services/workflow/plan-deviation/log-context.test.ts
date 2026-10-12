/**
 * log-context tests — clamped ±N lines around a deviation, masked.
 */
import { describe, expect, test } from 'bun:test';
import { fetchLogContext, resolveContextWindow, type LogContextSource } from './log-context';

const SECRET = 'sk-' + 'Mm1Nn2Oo3Pp4Qq5Rr6Ss7Tt8';

/** In-memory log source with sequenceNumbers 0..9. */
function source(): LogContextSource & { calls: Array<[number, number]> } {
  const rows = Array.from({ length: 10 }, (_, i) => ({
    sequenceNumber: i,
    logChunk: i === 5 ? `[Tool: Bash] curl -H "Bearer ${SECRET}"` : `line ${i}`,
  }));
  const calls: Array<[number, number]> = [];
  return {
    calls,
    async getBounds() {
      return { min: 0, max: 9 };
    },
    async getRange(from, to) {
      calls.push([from, to]);
      return rows.filter((r) => r.sequenceNumber >= from && r.sequenceNumber <= to);
    },
  };
}

describe('resolveContextWindow', () => {
  test('defaults to 5, caps at 20, rejects negatives', () => {
    expect(resolveContextWindow(undefined)).toBe(5);
    expect(resolveContextWindow(50)).toBe(20);
    expect(resolveContextWindow(-3)).toBe(0);
    expect(resolveContextWindow(Number.NaN)).toBe(5);
  });
});

describe('fetchLogContext', () => {
  test('returns ±N lines with the target flagged and secrets masked', async () => {
    const r = await fetchLogContext(source(), { seq: 5, before: 2, after: 2 });
    expect(r.lines.map((l) => l.sequenceNumber)).toEqual([3, 4, 5, 6, 7]);
    expect(r.lines.filter((l) => l.isTarget).map((l) => l.sequenceNumber)).toEqual([5]);
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(r.lines[2].text).toContain('[REDACTED]');
  });

  test('clamps at the head and tail', async () => {
    const head = await fetchLogContext(source(), { seq: 0, before: 5, after: 1 });
    expect(head.lines.map((l) => l.sequenceNumber)).toEqual([0, 1]);
    const tail = await fetchLogContext(source(), { seq: 9, before: 1, after: 5 });
    expect(tail.lines.map((l) => l.sequenceNumber)).toEqual([8, 9]);
  });

  test('an out-of-range seq is clamped into range', async () => {
    const s = source();
    const r = await fetchLogContext(s, { seq: 500, before: 1, after: 1 });
    expect(r.lines.map((l) => l.sequenceNumber)).toEqual([8, 9]);
    expect(r.lines.find((l) => l.isTarget)?.sequenceNumber).toBe(9);
  });

  test('no logs → empty', async () => {
    const empty: LogContextSource = {
      async getBounds() {
        return null;
      },
      async getRange() {
        return [];
      },
    };
    expect(await fetchLogContext(empty, { seq: 1 })).toEqual({ lines: [] });
  });
});
