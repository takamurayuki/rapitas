/**
 * jury-unavailable-risk テスト
 *
 * When the jury cannot decide, the risk call uses evidence (the diff's paths,
 * research.md's リスク判定, plan.md's declared files) before any keyword guess.
 */
import { describe, test, expect } from 'bun:test';
import { resolveJuryUnavailableRisk } from './jury-unavailable-risk';

const LOW_RESEARCH = '## リスク判定\nリスク: 低\n対象領域: なし\n根拠: 表示だけ\n';
const HIGH_RESEARCH = '## リスク判定\nリスク: 高\n対象領域: 認証\n根拠: auth-guard.ts を変更\n';

describe('resolveJuryUnavailableRisk', () => {
  test('差分が危険なパス（スキーマ・認証）を変えていれば高リスク', () => {
    const r = resolveJuryUnavailableRisk({
      changedFiles: ['rapitas-backend/prisma/schema/core.prisma', 'src/a.ts'],
      researchContent: LOW_RESEARCH,
      title: 'ラベルの文言を直す',
    });
    expect(r.high).toBe(true);
    expect(r.source).toBe('diff_paths');
    expect(r.files).toEqual(['rapitas-backend/prisma/schema/core.prisma']);
  });

  test('調査のリスク判定が高なら高リスク', () => {
    const r = resolveJuryUnavailableRisk({
      changedFiles: ['src/a.ts'],
      researchContent: HIGH_RESEARCH,
      title: 'x',
    });
    expect(r).toMatchObject({ high: true, source: 'research_verdict' });
  });

  test('タイトルに認証の語があっても、根拠（調査が低・差分が安全）があれば低リスク', () => {
    const r = resolveJuryUnavailableRisk({
      changedFiles: ['src/components/LoginHint.tsx'],
      researchContent: LOW_RESEARCH,
      title: 'ログイン画面のヒント文言を直す',
      description: 'auth には触れない',
    });
    expect(r).toMatchObject({ high: false, source: 'evidence_clear' });
  });

  test('根拠が何も無いときだけキーワード判定に落ちる', () => {
    const r = resolveJuryUnavailableRisk({ title: '決済の再試行を直す' });
    expect(r).toMatchObject({ high: true, source: 'keyword_fallback' });
    expect(resolveJuryUnavailableRisk({ title: '文言修正' })).toMatchObject({
      high: false,
      source: 'keyword_fallback',
    });
  });
});
