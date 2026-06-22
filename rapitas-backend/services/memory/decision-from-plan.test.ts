/**
 * extractPlanDecisions テスト
 *
 * plan.md の `## 意思決定` セクション抽出ロジックを検証する。
 */
import { describe, test, expect } from 'bun:test';
import { extractPlanDecisions } from './decision-from-plan';

describe('extractPlanDecisions', () => {
  test('`## 意思決定` 配下の `- 採用: 選択 ｜ 理由: 理由` を分解する', () => {
    const md = [
      '# 実装計画',
      '## 手順',
      '- 何か',
      '## 意思決定',
      '- 採用: キャッシュTTLを config に集約 ｜ 理由: 重複定義の解消',
      '- 採用: 環境変数で上書き可能にする | 理由: 実験のため',
      '## リスク',
      '- 採用: これは別セクションなので無視',
    ].join('\n');
    const out = extractPlanDecisions(md);
    expect(out.length).toBe(2);
    expect(out[0]!.decision).toContain('config に集約');
    expect(out[0]!.rationale).toBe('重複定義の解消');
    expect(out[1]!.rationale).toBe('実験のため'); // 半角 | セパレータも許容
  });

  test('採用接頭辞・理由節が無くても decision として拾う', () => {
    const md = '## Decisions\n- worktree 共有方式を維持する';
    const out = extractPlanDecisions(md);
    expect(out.length).toBe(1);
    expect(out[0]!.decision).toContain('worktree');
    expect(out[0]!.rationale).toBe('');
  });

  test('意思決定セクションが無ければ空配列', () => {
    expect(extractPlanDecisions('# 計画\n## 手順\n- なし')).toEqual([]);
    expect(extractPlanDecisions('')).toEqual([]);
    expect(extractPlanDecisions(null)).toEqual([]);
  });

  test('最大6件で打ち切る', () => {
    const lines = ['## 意思決定'];
    for (let i = 0; i < 10; i++) lines.push(`- 採用: 設計判断の選択 番号${i} を採用する`);
    expect(extractPlanDecisions(lines.join('\n')).length).toBe(6);
  });

  test('予測・確信度の節を順不同で解析する', () => {
    const md = [
      '## 意思決定',
      '- 採用: キャッシュTTLを15秒に延長 ｜ 理由: API負荷の低減 ｜ 予測: P95レイテンシが20%改善 ｜ 確信度: 70%',
      '- 採用: 確信度を先に書くケース ｜ 確信度: 40% ｜ 理由: 不確実性が高い',
    ].join('\n');
    const out = extractPlanDecisions(md);
    expect(out[0]!.predictedOutcome).toBe('P95レイテンシが20%改善');
    expect(out[0]!.confidence).toBeCloseTo(0.7, 5);
    expect(out[0]!.rationale).toBe('API負荷の低減');
    // 順不同でも確信度を拾い、予測が無ければ undefined のまま（理由はコピーしない）。
    expect(out[1]!.confidence).toBeCloseTo(0.4, 5);
    expect(out[1]!.predictedOutcome).toBeUndefined();
  });

  test('予測・確信度が無ければ undefined（理由を流用しない）', () => {
    const out = extractPlanDecisions(
      '## 意思決定\n- 採用: worktree共有方式を維持する ｜ 理由: 依存ツリーの共有',
    );
    expect(out[0]!.predictedOutcome).toBeUndefined();
    expect(out[0]!.confidence).toBeUndefined();
    expect(out[0]!.rationale).toBe('依存ツリーの共有');
  });
});
