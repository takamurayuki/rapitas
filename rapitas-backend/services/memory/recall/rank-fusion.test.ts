/**
 * rank-fusion テスト
 *
 * 両チャネル出現の優位・片チャネルのみ・同点の id 昇順タイブレークを検証する。
 */
import { describe, test, expect } from 'bun:test';
import { fuseRankings } from './rank-fusion';

describe('fuseRankings', () => {
  test('両チャネルに出現する id は片方だけの id より上位', () => {
    const out = fuseRankings([1, 2, 3], [3, 4]);
    expect(out[0].id).toBe(3);
    expect(out[0].vectorRank).toBe(3);
    expect(out[0].lexicalRank).toBe(1);
  });

  test('片チャネルのみでも順位を保って返す', () => {
    const out = fuseRankings([], [7, 8]);
    expect(out.map((r) => r.id)).toEqual([7, 8]);
    expect(out[0].vectorRank).toBeNull();
    expect(out[0].lexicalRank).toBe(1);
  });

  test('fused が同点なら id 昇順', () => {
    // 9 is vector rank 1, 4 is lexical rank 1 → identical fused score.
    const out = fuseRankings([9], [4]);
    expect(out.map((r) => r.id)).toEqual([4, 9]);
    expect(out[0].fused).toBeCloseTo(out[1].fused, 12);
  });

  test('空入力は空配列', () => {
    expect(fuseRankings([], [])).toEqual([]);
  });

  test('k を大きくすると順位差の影響が平坦になる', () => {
    const tight = fuseRankings([1, 2], [], 1);
    const flat = fuseRankings([1, 2], [], 1000);
    expect(tight[0].fused - tight[1].fused).toBeGreaterThan(flat[0].fused - flat[1].fused);
  });
});
