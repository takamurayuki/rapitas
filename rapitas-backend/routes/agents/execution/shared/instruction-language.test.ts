/**
 * instruction-language.test
 *
 * The output-language directive must exist for both languages and keep
 * commits/PRs out of scope.
 */
import { describe, test, expect } from 'bun:test';
import { buildOutputLanguageSection } from './instruction-language';

describe('buildOutputLanguageSection', () => {
  test('ja asks for Japanese documents and reports', () => {
    const section = buildOutputLanguageSection('ja');
    expect(section.startsWith('\n\n## 出力言語\n')).toBe(true);
    expect(section).toContain('日本語');
    expect(section).toContain('research.md / plan.md / verify.md / question.md');
    expect(section).toContain('英語のまま');
  });

  test('en asks for English documents and reports', () => {
    const section = buildOutputLanguageSection('en');
    expect(section.startsWith('\n\n## Output Language\n')).toBe(true);
    expect(section).toContain('in English');
    expect(section).toContain('Commit messages and PR bodies stay in English');
  });
});
