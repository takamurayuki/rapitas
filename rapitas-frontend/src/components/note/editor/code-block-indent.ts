/**
 * code-block-indent
 *
 * Indentation utilities for the note editor's code blocks.
 * Responsible for determining indent strings, reading current-line context,
 * and deciding whether to auto-indent after a line.
 * Not responsible for DOM structure or syntax highlighting.
 */

/** Languages that auto-indent after a trailing `{`. */
const BRACE_INDENT_LANGS = [
  'javascript',
  'typescript',
  'java',
  'csharp',
  'cpp',
  'c',
  'rust',
  'go',
  'php',
  'swift',
  'kotlin',
];

/**
 * Get the current line text before the cursor position.
 *
 * @param range - Current selection range / 現在の選択範囲
 * @returns Text of the line up to the cursor / カーソル前の行テキスト
 */
export function getCurrentLine(range: Range): string {
  const container = range.startContainer;
  const text = container.textContent ?? '';
  const beforeCursor = text.substring(0, range.startOffset);
  const lines = beforeCursor.split('\n');
  return lines[lines.length - 1];
}

/**
 * Extract leading whitespace from a line.
 *
 * @param line - Source line / ソース行
 * @returns Leading whitespace string / 先頭の空白文字列
 */
export function getIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

/**
 * Return the indent string appropriate for the language.
 *
 * @param lang - Language identifier / 言語識別子
 * @returns Indent string (spaces or tab) / インデント文字列
 */
export function getIndentString(lang: string): string {
  if (lang === 'python') return '    ';
  // NOTE: Go and Rust conventionally use tabs; all other languages use 2 spaces.
  if (lang === 'go' || lang === 'rust') return '\t';
  return '  ';
}

/**
 * Decide whether to auto-indent after the given line.
 *
 * @param line - Current source line / 現在のソース行
 * @param lang - Language identifier / 言語識別子
 * @returns True if the next line should be indented deeper / 次行をインデントすべき場合true
 */
export function shouldAutoIndent(line: string, lang: string): boolean {
  const trimmed = line.trim();

  if (BRACE_INDENT_LANGS.includes(lang)) {
    if (trimmed.endsWith('{')) return true;
  }

  if (['python', 'ruby'].includes(lang)) {
    if (trimmed.endsWith(':')) return true;
  }

  if (['html', 'xml'].includes(lang)) {
    if (
      /<[^>]+>$/.test(trimmed) &&
      !/<\/[^>]+>$/.test(trimmed) &&
      !/>\/\s*$/.test(trimmed)
    ) {
      return true;
    }
  }

  return false;
}
