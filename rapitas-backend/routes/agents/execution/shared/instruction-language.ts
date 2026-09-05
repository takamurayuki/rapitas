/**
 * execution/instruction-language
 *
 * The "output language" directive prepended to every manually dispatched
 * agent instruction. Mirrors the directive the auto-run CLI prompt already
 * carries (workflow-cli-executor-prompt.ts) so both dispatch paths ask for
 * the same language — the one the user has the UI in.
 * Not responsible for resolving which language that is (prompt-language-store).
 */
import type { PromptLanguage } from '../../../../services/system/prompt-language-store';

/**
 * Build the output-language section for an agent instruction.
 *
 * @param language - Language the agent must write documents and reports in / 出力言語
 * @returns Markdown section, leading blank line included / Markdownセクション
 */
export function buildOutputLanguageSection(language: PromptLanguage): string {
  // NOTE: Commit messages and PR bodies stay English by CLAUDE.md; only
  // documents (research/plan/verify/question) and the agent's own reports
  // follow the UI language (operator decision 2026-09-05).
  if (language === 'en') {
    return (
      '\n\n## Output Language\n' +
      'Write ALL documents (research.md / plan.md / verify.md / question.md), progress reports, ' +
      'questions and the final summary in English. Keep section headings exactly as the templates ' +
      'give them. Commit messages and PR bodies stay in English regardless of this setting.'
    );
  }
  return (
    '\n\n## 出力言語\n' +
    'すべての文書（research.md / plan.md / verify.md / question.md）、進捗報告、質問文、最終サマリは' +
    '**日本語**で書いてください。見出しはテンプレートの形をそのまま使います。' +
    'コミットメッセージと PR 本文はこの設定に関係なく英語のままにします。'
  );
}
