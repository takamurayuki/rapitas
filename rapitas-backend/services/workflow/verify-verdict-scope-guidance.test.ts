/**
 * verify-verdict-scope-guidance.test
 *
 * E1: the same condition produced different verdicts, so a bounce became luck.
 * Measured across all 534 verify_repair bounces — 162 (30%) carry "verify.md
 * explicitly reports a failed or partial overall verdict", over 68 tasks, 15 of
 * which repeated it 3+ times (#907/#980 fifteen each, #973 twelve, #881 eight).
 *
 * These assertions are deliberately about the RULE being stated, not about
 * wording: a verifier that is never told which findings may move the verdict
 * will keep choosing differently run to run.
 */
import { describe, expect, test } from 'bun:test';
import {
  VERDICT_SCOPE_GUIDANCE_JA,
  VERDICT_SCOPE_GUIDANCE_EN,
} from './verify-verdict-scope-guidance';

describe.each([
  ['ja', VERDICT_SCOPE_GUIDANCE_JA],
  ['en', VERDICT_SCOPE_GUIDANCE_EN],
])('%s guidance', (_lang, text) => {
  test('全体判定を動かす条件を1つに定める', () => {
    // The positive rule: only this task's criteria / this task's diff.
    expect(text).toMatch(/受入基準|acceptance criterion/);
    expect(text).toMatch(/差分|diff/);
  });

  test('advisory / 既存の失敗を除外し、ただし根拠を要求する', () => {
    expect(text).toMatch(/advisory/i);
    // The exemption must not be free: evidence that it predates the diff.
    expect(text).toMatch(/根拠|evidence/);
    expect(text).toMatch(/実失敗として扱|treat it as a real failure/);
  });

  test('スコープ外・別タスク追跡の項目を除外し、追跡先 id を要求する', () => {
    expect(text).toMatch(/スコープ外|out of scope/);
    expect(text).toMatch(/id/);
  });

  test('受入基準の無い注記を除外する', () => {
    expect(text).toMatch(/未計測|unmeasured/);
  });

  test('判定語彙は機械ゲートが読む表記のまま使う', () => {
    expect(text).toMatch(/⚠️/);
    expect(text).toMatch(/✅/);
  });

  test('規約の根拠として実測値を持つ', () => {
    expect(text).toContain('162');
    expect(text).toContain('534');
    expect(text).toContain('#881');
  });
});

describe('the verifier prompt carries it', () => {
  test('ja/en 両方の検証者プロンプトに差し込まれている', async () => {
    const { buildRoleTexts } = await import('./workflow-role-prompts');
    for (const [language, guidance] of [
      ['ja', VERDICT_SCOPE_GUIDANCE_JA],
      ['en', VERDICT_SCOPE_GUIDANCE_EN],
    ] as const) {
      const texts = buildRoleTexts(1, { title: 't', description: null }, language);
      expect(JSON.stringify(texts)).toContain(JSON.stringify(guidance).slice(1, -1));
    }
  });
});
