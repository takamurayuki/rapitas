/**
 * researchConcludesNoChange テスト
 *
 * 調査段階で「既存実装で要件充足＝修正不要」と明示結論した research.md を検出し、
 * 通常の調査メモ（既存実装に言及しつつ変更を提案する等）を誤検出しないこと。
 */
import { describe, test, expect } from 'bun:test';
import { researchConcludesNoChange } from '../../services/workflow/completion-gate';

describe('researchConcludesNoChange', () => {
  test('「## 結論: 修正不要」見出しを検出すること', () => {
    const md = ['# 調査結果', '本文', '', '## 結論: 修正不要', '- 既存実装で充足'].join('\n');
    expect(researchConcludesNoChange(md)).toBe(true);
  });

  test('「結論: 既存実装で要件を満たすため対応不要」を検出すること', () => {
    const md = '## 結論: 既存実装で要件を満たすため対応不要です';
    expect(researchConcludesNoChange(md)).toBe(true);
  });

  test('機械トークン「修正不要: true」を検出すること', () => {
    expect(researchConcludesNoChange('修正不要: true')).toBe(true);
  });

  test('英語 conclusion: no change needed を検出すること', () => {
    expect(researchConcludesNoChange('## Conclusion: No change needed')).toBe(true);
  });

  test('変更を提案する通常の調査は誤検出しないこと', () => {
    const md = [
      '# 調査結果',
      '## 影響範囲',
      '既存実装を確認したが、要件を満たすには idea-extractor.ts の修正が必要。',
      '## 実装方針の選択肢',
      '- 選択肢A: ...',
    ].join('\n');
    expect(researchConcludesNoChange(md)).toBe(false);
  });

  test('空・null は false', () => {
    expect(researchConcludesNoChange('')).toBe(false);
    expect(researchConcludesNoChange(null)).toBe(false);
    expect(researchConcludesNoChange(undefined)).toBe(false);
  });
});
