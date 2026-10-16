/**
 * code-block-highlight
 *
 * Public entry point for the note editor's code-block syntax highlighting.
 * Exposes `highlightCode` plus the caret-offset helpers, delegating tokenizing
 * and rendering to `code-block-tokenizer` and caret math to `code-block-cursor`.
 * This file preserves the original import path so existing callers need no change.
 */

import { tokenize, renderTokens } from './code-block-tokenizer';

// Re-export caret helpers so the original import path stays valid.
export { getCursorOffset, setCursorOffset } from './code-block-cursor';

/**
 * Syntax-highlight source code text for a given language.
 * Returns an HTML string suitable for setting as innerHTML on a display element.
 *
 * @param text - Raw source code (plain text) / ハイライトするソースコード
 * @param lang - Language identifier (e.g. "typescript") / 言語識別子
 * @returns HTML string with highlight spans / ハイライト済みHTML文字列
 */
export function highlightCode(text: string, lang: string): string {
  if (!text) return '';
  return renderTokens(tokenize(text, lang));
}
