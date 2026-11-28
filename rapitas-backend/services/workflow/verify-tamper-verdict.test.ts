/**
 * verify-tamper-verdict — the tamper-only cutoff must not swallow a fixable
 * failure (task 1602)
 *
 * The old check listed the gates that count as "something else failed"; any
 * gate added later (generated-sync, secret, …) read as tamper-only and the
 * repair loop was cut off although the implementer could fix it.
 */
import { describe, expect, test } from 'bun:test';
import { isTamperOnlyVerdict } from './verify-tamper-verdict';

describe('isTamperOnlyVerdict', () => {
  test('tamper with a new catalog check failing is not tamper-only', () => {
    expect(isTamperOnlyVerdict('自動検証: tamper=NG(1) / secret=NG(1)')).toBe(false);
  });

  test('tamper with generated-sync failing is not tamper-only', () => {
    expect(isTamperOnlyVerdict('自動検証: tamper=NG(1) / generated-sync=NG(1)')).toBe(false);
  });

  test('tamper with only advisory checks failing is tamper-only', () => {
    expect(isTamperOnlyVerdict('自動検証: tamper=NG(1) / lint=ok / acceptance=NG(1)')).toBe(true);
    expect(isTamperOnlyVerdict('tamper=NG(2) / attribution=NG(3) / test=skip')).toBe(true);
  });

  test('no tamper failure is never tamper-only', () => {
    expect(isTamperOnlyVerdict('lint=NG(1)')).toBe(false);
    expect(isTamperOnlyVerdict('tamper=ok')).toBe(false);
  });
});
