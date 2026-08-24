/**
 * research-risk.test
 *
 * Covers parsing the research agent's own risk verdict. The verdict is read
 * ONLY from inside the リスク判定 section — the rest of a research report quotes
 * code and prior findings, which is the prose noise this module exists to stop
 * trusting.
 */
import { describe, test, expect } from 'bun:test';
import { parseResearchRisk } from './research-risk';

const NL = String.fromCharCode(10);
const doc = (...lines: string[]) => lines.join(NL);

describe('parseResearchRisk', () => {
  test('reads a 高 verdict and its areas', () => {
    const md = doc(
      '# 調査',
      '本文',
      '## リスク判定',
      'リスク: 高',
      '対象領域: スキーマ, 認証',
      '根拠: core.prisma を変更',
    );
    expect(parseResearchRisk(md)).toEqual({ high: true, areas: ['schema', 'auth'] });
  });

  test('reads a 低 verdict with no areas', () => {
    const md = doc('## リスク判定', 'リスク: 低', '対象領域: なし', '根拠: ルーティングのみ');
    expect(parseResearchRisk(md)).toEqual({ high: false, areas: [] });
  });

  test('accepts the english spelling', () => {
    const md = doc('## Risk Assessment', 'リスク: high', 'areas: payment');
    expect(parseResearchRisk(md)).toEqual({ high: true, areas: ['payment'] });
  });

  test('returns null when the section is absent so callers keep the keyword fallback', () => {
    expect(
      parseResearchRisk('# 調査' + NL + '認証まわりを読んだ。スキーマは触らない。'),
    ).toBeNull();
    expect(parseResearchRisk('')).toBeNull();
    expect(parseResearchRisk(null)).toBeNull();
  });

  test('ignores risk words that live OUTSIDE the section', () => {
    // 認証/決済 appear in the body; only the section decides.
    const md = doc(
      '# 調査',
      '認証と決済のコードを読んだが、いずれも変更しない。',
      '## リスク判定',
      'リスク: 低',
      '対象領域: なし',
    );
    expect(parseResearchRisk(md)).toEqual({ high: false, areas: [] });
  });

  test('returns null when the section exists but states no verdict', () => {
    expect(parseResearchRisk(doc('## リスク判定', '未評価'))).toBeNull();
  });
});
