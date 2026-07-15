/**
 * idea-promotion-diversity テスト
 *
 * 起票時の多様性選抜: 直近起票タスクとの類似スキップ、バッチ内相互類似の
 * スキップ、QDセル衝突の回避、全滅時のフォールバック（起票を止めない）を検証。
 */
import { describe, test, expect } from 'bun:test';
import { pickDiverseIdeas, ideaCell } from './idea-promotion-diversity';

const idea = (id: number, title: string, tags: string[] = []) => ({
  id,
  title,
  content: 'c',
  tags,
});

describe('pickDiverseIdeas', () => {
  test('直近起票タスクに類似するアイデアはスキップされる', () => {
    const r = pickDiverseIdeas(
      [
        idea(1, 'サブタスク説明の表示をさらに改善する'), // 直近起票と同系統
        idea(2, 'ポモドーロタイマーの統計グラフ追加'),
      ],
      ['[Idea] サブタスク説明の表示改善'],
      2,
    );
    expect(r.picked[0]!.id).toBe(2);
    expect(r.skippedAsSimilar).toBeGreaterThanOrEqual(1);
  });

  test('バッチ内で相互に類似するアイデアは1件だけ採択される（厳格パス）', () => {
    const r = pickDiverseIdeas(
      [
        idea(1, '型ガード関数の標準化'),
        idea(2, '型ガード関数の汎用化'), // 1 と同系統
        idea(3, 'アイコン選択UIのキーボード操作対応'),
      ],
      [],
      2,
    );
    expect(r.picked.map((p) => p.id)).toEqual([1, 3]);
  });

  test('同じ QD セルのアイデアは同一バッチに2件入らない', () => {
    const r = pickDiverseIdeas(
      [
        idea(1, 'まったく違うタイトルA', ['cell:ui/改善/開発者']),
        idea(2, '完全に別のトピックB', ['cell:ui/改善/開発者']), // セル衝突
        idea(3, '第三の独立した提案C', ['cell:memory/新機能/運用者']),
      ],
      [],
      2,
    );
    expect(r.picked.map((p) => p.id)).toEqual([1, 3]);
  });

  test('全候補が同系統でも起票は止まらない（フォールバックで充足）', () => {
    const r = pickDiverseIdeas(
      [idea(1, '型ガード関数の標準化'), idea(2, '型ガード関数の汎用化')],
      ['[Idea] 型ガード関数の一元化'],
      2,
    );
    expect(r.picked).toHaveLength(2);
    expect(r.fallbackUsed).toBe(true);
  });

  test('n=0 / 候補なしは空', () => {
    expect(pickDiverseIdeas([], [], 3).picked).toEqual([]);
    expect(pickDiverseIdeas([idea(1, 'x')], [], 0).picked).toEqual([]);
  });
});

describe('ideaCell', () => {
  test('cell: タグを抽出、無ければ null', () => {
    expect(ideaCell(['scope:project', 'cell:ui/改善/開発者'])).toBe('ui/改善/開発者');
    expect(ideaCell(['scope:project'])).toBeNull();
  });
});
