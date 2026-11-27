/**
 * workflow-role-prompts.test-scope.test
 *
 * 2026-11-28: task 1542's verifier ran the whole backend suite (about 1,000
 * files, before and after the change, four at a time) three rounds in a row,
 * and test runs that hung piled up as bun processes. Verification only needs
 * the tests related to the change, so the implementer and verifier are told
 * to run those and to leave the whole suite to CI.
 */
import { describe, expect, test } from 'bun:test';
import { buildRoleTexts } from './workflow-role-prompts';

const TASK = { title: 'Probe', description: null };

describe('test scope guidance (no whole-suite runs)', () => {
  test('ja: implementer and verifier are told to run only the related tests', () => {
    const texts = buildRoleTexts(1, TASK, 'ja');
    for (const text of [texts.implementer.constraints, texts.verifier.instruction]) {
      expect(text).toContain(
        '変更したファイルのテストと、変更したファイルを直接 import しているテスト',
      );
      expect(text).toContain('スイート全体やディレクトリ全体のテストは実行しない');
      expect(text).toContain('CI');
    }
  });

  test('en: implementer and verifier are told to run only the related tests', () => {
    const texts = buildRoleTexts(1, TASK, 'en');
    for (const text of [texts.implementer.constraints, texts.verifier.instruction]) {
      expect(text).toContain(
        'tests of the changed files and the test files that import them directly',
      );
      expect(text).toContain('never run the whole suite or a whole directory');
      expect(text).toContain('CI');
    }
  });
});
