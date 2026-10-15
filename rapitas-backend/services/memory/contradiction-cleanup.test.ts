/**
 * contradiction-cleanup テスト
 *
 * decideBulkCleanup の一括判定を検証: 近似重複ペアのdedup、dead-side解決、
 * decayScoreギャップ解決、係争ペアの温存、そしてdedup敗者のdead化が同一パス内で
 * 他ペアへ波及する(クラスタが一晩で崩れる)こと。
 */
import { describe, test, expect } from 'bun:test';
import { decideBulkCleanup, type CleanupEntry, type CleanupRow } from './contradiction-cleanup';

let nextId = 1;
function entry(over: Partial<CleanupEntry> = {}): CleanupEntry {
  return {
    id: over.id ?? nextId++,
    title: over.title ?? `独立した知識 ${Math.random().toString(36).slice(2, 8)}`,
    content: over.content ?? `内容 ${Math.random().toString(36).slice(2, 10)}`,
    decayScore: over.decayScore ?? 0.5,
    validationStatus: over.validationStatus ?? 'conflict',
    forgettingStage: over.forgettingStage ?? 'active',
  };
}

function row(id: number, entryA: CleanupEntry, entryB: CleanupEntry): CleanupRow {
  return { id, entryA, entryB };
}

describe('decideBulkCleanup', () => {
  test('near-duplicate pair → keep stronger, reject weaker', () => {
    const strong = entry({
      id: 10,
      title: 'マージ競合解消の原則',
      content: '両方の変更意図を保持し競合マーカーを完全除去する',
      decayScore: 0.8,
    });
    const weak = entry({
      id: 11,
      title: 'マージ競合解消時の原則',
      content: '両方の変更意図を保持し競合マーカーは完全に除去すること',
      decayScore: 0.4,
    });
    const d = decideBulkCleanup([row(1, strong, weak)]);
    expect(d.keepA).toEqual([1]);
    expect(d.rejectEntryIds).toEqual([11]);
    expect(d.contested).toHaveLength(0);
  });

  test('dead side → keep the survivor without touching entries', () => {
    const deadEntry = entry({ id: 20, validationStatus: 'rejected' });
    const alive = entry({ id: 21 });
    const d = decideBulkCleanup([row(2, deadEntry, alive)]);
    expect(d.keepB).toEqual([2]);
    expect(d.rejectEntryIds).toHaveLength(0);
  });

  test('both sides dead → dismiss', () => {
    const a = entry({ id: 30, forgettingStage: 'archived' });
    const b = entry({ id: 31, validationStatus: 'rejected' });
    const d = decideBulkCleanup([row(3, a, b)]);
    expect(d.dismiss).toEqual([3]);
  });

  test('decayScore gap >= 0.3 → keep the outcome-proven side', () => {
    const proven = entry({ id: 40, decayScore: 0.9 });
    const stale = entry({ id: 41, decayScore: 0.2 });
    const d = decideBulkCleanup([row(4, stale, proven)]);
    expect(d.keepB).toEqual([4]);
    expect(d.rejectEntryIds).toEqual([41]); // the stale side loses
  });

  test('genuinely contested pair stays open for the LLM drain', () => {
    const a = entry({
      id: 50,
      title: 'デプロイは金曜に行う',
      content: '監視できるため金曜夕方が最適',
    });
    const b = entry({ id: 51, title: 'デプロイ禁止曜日', content: '金曜のデプロイは絶対に避ける' });
    const d = decideBulkCleanup([row(5, a, b)]);
    expect(d.contested).toEqual([5]);
    expect(d.keepA).toHaveLength(0);
    expect(d.keepB).toHaveLength(0);
  });

  test('dedup loss CASCADES: the loser is dead for its other pairs in the same pass', () => {
    // Cluster of 3 paraphrases: A(strong) ~ B(weak), B ~ C where B-C is not
    // lexically similar enough on its own — but B dying to A resolves B-C too.
    const a = entry({
      id: 60,
      title: 'PRブランチ更新はpushで完結させる',
      content: 'PRブランチの更新はpushだけで完結させ、追加操作を行わない',
      decayScore: 0.9,
    });
    const b = entry({
      id: 61,
      title: 'PRブランチ更新はpushで完結',
      content: 'PRブランチの更新はpushのみで完結させ追加の操作をしない',
      decayScore: 0.3,
    });
    const c = entry({
      id: 62,
      title: '全く別の観点の知識',
      content: 'まったく異なるトピックについての独立した内容である',
      decayScore: 0.35,
    });
    const d = decideBulkCleanup([row(6, a, b), row(7, b, c)]);
    expect(d.keepA).toContain(6); // A beats B (dedup)
    expect(d.rejectEntryIds).toEqual([61]);
    expect(d.keepB).toContain(7); // B is now dead → C survives pair 7
    expect(d.contested).toHaveLength(0);
  });
});
