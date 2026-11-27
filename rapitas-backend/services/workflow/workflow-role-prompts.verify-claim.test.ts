/**
 * workflow-role-prompts.verify-claim.test
 *
 * The verifier prompt (ja/en) teaches the `json:verify-claim` block and states
 * that failure history and RED checks may be written honestly (task 1542).
 */
import { describe, expect, test } from 'bun:test';
import { buildRoleTexts } from './workflow-role-prompts';
import { parseVerifyClaim } from './verify-claim';

describe.each([
  ['ja', '正直に書いてかまいません', 'RED の確認'],
  ['en', 'honestly write', 'RED checks'],
] as const)('verifier prompt (%s)', (language, honestPhrase, redPhrase) => {
  const text = buildRoleTexts(1542, { title: 'Probe', description: null }, language).verifier
    .instruction;

  test('shows the claim block and its keys', () => {
    expect(text).toContain('json:verify-claim');
    for (const key of ['runId', 'sha', 'overall', 'tests']) expect(text).toContain(key);
  });

  test('the example block is itself a well-formed claim', () => {
    expect(parseVerifyClaim(text).kind).toBe('ok');
  });

  test('names passedCount as the source of tests.passed', () => {
    expect(text).toContain('passedCount');
    expect(text).toContain('errorCount');
  });

  test('says failure history and RED checks may be written honestly', () => {
    expect(text).toContain(honestPhrase);
    expect(text).toContain(redPhrase);
  });

  test('RED確認の失敗件数や集計行を隠す指示を含めない', () => {
    const concealCounts =
      language === 'ja'
        ? /数値集計行を本文に書かない|集計行は含めない/
        : /do NOT write numeric summary lines|summary count lines removed/;
    expect(text).not.toMatch(concealCounts);
  });
});
