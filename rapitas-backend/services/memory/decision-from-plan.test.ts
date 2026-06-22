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
});
