/**
 * useGenerationHistory.test
 *
 * 生成した文書一式を履歴に残し、再生成せず選び直せるようにする部分の純粋関数。
 *
 * 背景（2026-10-12 の報告）: ウィザードは最新の生成物しか保持しておらず、前の版に
 * 戻るには再生成しかなかった。再生成はモデル呼び出しなので費用がかかるうえ、同じ
 * 出力が返る保証もない。
 */
import { describe, expect, it } from 'vitest';
import {
  appendHistory,
  describeEntry,
  MAX_HISTORY,
  type GenerationEntry,
} from '../useGenerationHistory';

function entry(round: number, over: Partial<GenerationEntry> = {}): GenerationEntry {
  return {
    round,
    at: 1_700_000_000_000 + round,
    result: { score: 90, tech_rationale: '', claude_md: '', requirements: '' },
    review: null,
    ...over,
  };
}

describe('appendHistory', () => {
  it('古い順に積む', () => {
    const h = appendHistory(appendHistory([], entry(1)), entry(2));
    expect(h.map((e) => e.round)).toEqual([1, 2]);
  });

  it('上限を超えたら最も古いものを落とす', () => {
    let h: GenerationEntry[] = [];
    for (let i = 1; i <= MAX_HISTORY + 2; i += 1) h = appendHistory(h, entry(i));
    expect(h).toHaveLength(MAX_HISTORY);
    // 最新は必ず残る
    expect(h[h.length - 1].round).toBe(MAX_HISTORY + 2);
    // 最古の2件は落ちている
    expect(h.some((e) => e.round === 1)).toBe(false);
    expect(h.some((e) => e.round === 2)).toBe(false);
  });

  it('元の配列を書き換えない', () => {
    const original = [entry(1)];
    appendHistory(original, entry(2));
    expect(original).toHaveLength(1);
  });
});

describe('describeEntry', () => {
  const requirements = [
    '# 機能要件',
    '- [F-01] あ',
    '- [F-02] い',
    '- [F-03] う',
    '# 受け入れ基準',
    '- [F-01] Given a When b Then c',
  ].join('\n');

  // 受け入れ基準は機能ごとに3件あるので、行数ではなく重複しない機能IDを数える。
  it('機能件数を重複しないIDで数える（受け入れ基準の繰り返しで増えない）', () => {
    const d = describeEntry(
      entry(1, { result: { score: 90, tech_rationale: '', claude_md: '', requirements } }),
    );
    expect(d).toContain('機能 3 件');
  });

  it('レビュー済みで error が無ければ「要対応なし」と出す', () => {
    const d = describeEntry(
      entry(1, {
        result: { score: 90, tech_rationale: '', claude_md: '', requirements },
        review: { findings: [], questions: [], implementable: true },
      }),
    );
    expect(d).toContain('要対応なし');
  });

  it('error と warning を区別して数える', () => {
    const d = describeEntry(
      entry(1, {
        result: { score: 90, tech_rationale: '', claude_md: '', requirements },
        review: {
          findings: [
            { code: 'a', severity: 'error', message: '' },
            { code: 'b', severity: 'error', message: '' },
            { code: 'c', severity: 'warning', message: '' },
          ],
          questions: [],
          implementable: false,
        },
      }),
    );
    expect(d).toContain('要対応 2 件');
    expect(d).toContain('警告 1 件');
  });

  it('レビュー未実施なら要対応の表示を出さない（0件と誤解させない）', () => {
    const d = describeEntry(entry(1, { review: null }));
    expect(d).not.toContain('要対応');
  });

  it('回答を反映した版はそれが分かる', () => {
    const d = describeEntry(entry(2, { answersBlock: 'Q1: はい' }));
    expect(d).toContain('回答を反映');
  });

  it('要件定義書が空でも落ちない', () => {
    expect(() =>
      describeEntry(entry(1, { result: { score: 0, tech_rationale: '', claude_md: '' } })),
    ).not.toThrow();
    expect(
      describeEntry(entry(1, { result: { score: 0, tech_rationale: '', claude_md: '' } })),
    ).toContain('機能 0 件');
  });
});
