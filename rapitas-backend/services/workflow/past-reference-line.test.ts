import { describe, expect, test } from 'bun:test';
import { isPastReferenceLine } from './past-reference-line';

describe('isPastReferenceLine', () => {
  test('past ❌ cited as resolved (t18630 / task 1174)', () => {
    expect(isPastReferenceLine('前回 ❌ と ⚠️ だった3項目は今回すべて完了')).toBe(true);
  });
  test('current failures stay detectable', () => {
    expect(isPastReferenceLine('❌ 3件が未達')).toBe(false);
    expect(isPastReferenceLine('前回 ❌、今回も失敗')).toBe(false);
    expect(isPastReferenceLine('前回 ❌ だった項目')).toBe(false);
    expect(isPastReferenceLine('前回は完了した')).toBe(false);
  });
});
