/**
 * code-block-highlight
 *
 * Syntax highlighting for the note editor's code blocks.
 * Uses a single-pass tokenizer so that strings, comments, keywords, and numbers
 * are identified in one traversal — eliminating the conflicting-regex problem
 * that arose when multiple regex passes modified the same HTML string.
 */

// ─── Language keyword tables ─────────────────────────────────────────────────

const KEYWORDS: Record<string, string[]> = {
  javascript: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'import',
    'export',
    'default',
    'from',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'finally',
    'typeof',
    'instanceof',
    'in',
    'of',
    'delete',
    'void',
    'null',
    'undefined',
    'true',
    'false',
  ],
  typescript: [
    'const',
    'let',
    'var',
    'function',
    'return',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'class',
    'extends',
    'new',
    'this',
    'super',
    'import',
    'export',
    'default',
    'from',
    'async',
    'await',
    'try',
    'catch',
    'throw',
    'finally',
    'typeof',
    'instanceof',
    'in',
    'of',
    'delete',
    'void',
    'null',
    'undefined',
    'true',
    'false',
    'interface',
    'type',
    'enum',
    'implements',
    'private',
    'public',
    'protected',
    'readonly',
    'abstract',
    'declare',
    'namespace',
    'module',
    'as',
    'satisfies',
    'keyof',
    'infer',
    'never',
    'unknown',
    'any',
  ],
  python: [
    'def',
    'class',
    'if',
    'else',
    'elif',
    'for',
    'while',
    'return',
    'import',
    'from',
    'as',
    'try',
    'except',
    'finally',
    'with',
    'lambda',
    'yield',
    'pass',
    'break',
    'continue',
    'True',
    'False',
    'None',
    'and',
    'or',
    'not',
    'in',
    'is',
    'del',
    'global',
    'nonlocal',
    'raise',
    'assert',
  ],
  java: [
    'public',
    'private',
    'protected',
    'class',
    'interface',
    'extends',
    'implements',
    'static',
    'final',
    'abstract',
    'void',
    'int',
    'long',
    'double',
    'float',
    'boolean',
    'char',
    'byte',
    'short',
    'String',
    'if',
    'else',
    'for',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'new',
    'this',
    'super',
    'try',
    'catch',
    'throw',
    'throws',
    'finally',
    'import',
    'package',
    'null',
    'true',
    'false',
    'instanceof',
  ],
  csharp: [
    'public',
    'private',
    'protected',
    'internal',
    'class',
    'interface',
    'struct',
    'enum',
    'namespace',
    'using',
    'static',
    'readonly',
    'const',
    'virtual',
    'override',
    'abstract',
    'sealed',
    'void',
    'int',
    'long',
    'double',
    'float',
    'bool',
    'string',
    'object',
    'var',
    'if',
    'else',
    'for',
    'foreach',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'new',
    'this',
    'base',
    'try',
    'catch',
    'throw',
    'finally',
    'async',
    'await',
    'null',
    'true',
    'false',
  ],
  go: [
    'func',
    'var',
    'const',
    'type',
    'struct',
    'interface',
    'map',
    'chan',
    'import',
    'package',
    'if',
    'else',
    'for',
    'range',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'go',
    'defer',
    'select',
    'goroutine',
    'nil',
    'true',
    'false',
    'make',
    'new',
    'len',
    'cap',
    'append',
    'delete',
  ],
  rust: [
    'fn',
    'let',
    'mut',
    'const',
    'static',
    'struct',
    'enum',
    'impl',
    'trait',
    'type',
    'use',
    'mod',
    'pub',
    'crate',
    'super',
    'self',
    'if',
    'else',
    'match',
    'for',
    'while',
    'loop',
    'break',
    'continue',
    'return',
    'async',
    'await',
    'where',
    'true',
    'false',
    'None',
    'Some',
    'Ok',
    'Err',
  ],
  php: [
    'function',
    'class',
    'interface',
    'trait',
    'extends',
    'implements',
    'new',
    'public',
    'private',
    'protected',
    'static',
    'abstract',
    'final',
    'readonly',
    'if',
    'else',
    'elseif',
    'for',
    'foreach',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'try',
    'catch',
    'throw',
    'finally',
    'echo',
    'print',
    'include',
    'require',
    'use',
    'namespace',
    'null',
    'true',
    'false',
    'array',
  ],
  ruby: [
    'def',
    'class',
    'module',
    'end',
    'if',
    'elsif',
    'else',
    'unless',
    'while',
    'until',
    'for',
    'do',
    'case',
    'when',
    'then',
    'return',
    'yield',
    'begin',
    'rescue',
    'ensure',
    'raise',
    'require',
    'include',
    'extend',
    'attr_reader',
    'attr_writer',
    'attr_accessor',
    'nil',
    'true',
    'false',
    'self',
  ],
  swift: [
    'func',
    'var',
    'let',
    'class',
    'struct',
    'enum',
    'protocol',
    'extension',
    'import',
    'if',
    'else',
    'for',
    'in',
    'while',
    'do',
    'switch',
    'case',
    'break',
    'continue',
    'return',
    'guard',
    'defer',
    'throw',
    'try',
    'catch',
    'async',
    'await',
    'nil',
    'true',
    'false',
    'self',
    'super',
    'init',
    'deinit',
    'public',
    'private',
    'internal',
    'open',
    'fileprivate',
    'static',
    'final',
  ],
  kotlin: [
    'fun',
    'val',
    'var',
    'class',
    'interface',
    'object',
    'companion',
    'data',
    'sealed',
    'abstract',
    'open',
    'override',
    'import',
    'package',
    'if',
    'else',
    'when',
    'for',
    'while',
    'do',
    'in',
    'return',
    'break',
    'continue',
    'try',
    'catch',
    'throw',
    'finally',
    'null',
    'true',
    'false',
    'this',
    'super',
    'by',
    'typealias',
    'suspend',
    'coroutine',
  ],
  sql: [
    'SELECT',
    'FROM',
    'WHERE',
    'AND',
    'OR',
    'NOT',
    'IN',
    'LIKE',
    'BETWEEN',
    'INSERT',
    'INTO',
    'VALUES',
    'UPDATE',
    'SET',
    'DELETE',
    'CREATE',
    'DROP',
    'ALTER',
    'TABLE',
    'INDEX',
    'VIEW',
    'DATABASE',
    'SCHEMA',
    'JOIN',
    'LEFT',
    'RIGHT',
    'INNER',
    'OUTER',
    'FULL',
    'CROSS',
    'ON',
    'GROUP',
    'BY',
    'ORDER',
    'HAVING',
    'LIMIT',
    'OFFSET',
    'DISTINCT',
    'COUNT',
    'SUM',
    'AVG',
    'MIN',
    'MAX',
    'AS',
    'NULL',
    'IS',
    'EXISTS',
    'PRIMARY',
    'KEY',
    'FOREIGN',
    'REFERENCES',
    'UNIQUE',
    'DEFAULT',
    'AUTO_INCREMENT',
  ],
};

// Languages that use C-style // and /* */ comments.
const C_COMMENT_LANGS = new Set([
  'javascript',
  'typescript',
  'java',
  'c',
  'cpp',
  'csharp',
  'go',
  'rust',
  'swift',
  'kotlin',
  'php',
  'css',
  'scss',
]);

// Languages that use # line comments.
const HASH_COMMENT_LANGS = new Set(['python', 'ruby', 'bash', 'shell', 'powershell', 'yaml']);

// ─── Token types and colors ───────────────────────────────────────────────────

type TokenKind = 'keyword' | 'string' | 'comment' | 'number' | 'plain';

interface Token {
  kind: TokenKind;
  text: string;
}

// VS Code-inspired dark theme palette
const TOKEN_STYLE: Record<TokenKind, string> = {
  keyword: 'color:#569cd6', // blue
  string: 'color:#ce9178', // warm orange
  comment: 'color:#6a9955;font-style:italic', // green italic
  number: 'color:#b5cea8', // light green
  plain: '',
};

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Tokenize `text` into a flat list of tokens for the given language.
 * Single-pass so comments, strings, keywords, and numbers never conflict.
 *
 * @param text - Raw source code (plain text, no HTML escaping) / 生ソースコード
 * @param lang - Language identifier / 言語識別子
 * @returns Ordered token list / トークンリスト
 */
function tokenize(text: string, lang: string): Token[] {
  const tokens: Token[] = [];
  const n = text.length;
  let i = 0;

  const keywordSet = new Set(KEYWORDS[lang] ?? []);
  const isIdChar = (c: string) => /[\w$]/.test(c);
  const isIdStart = (c: string) => /[a-zA-Z_$]/.test(c);

  // Helper to push a plain-text segment, merging adjacent plains for brevity
  const pushPlain = (s: string) => {
    if (!s) return;
    const last = tokens[tokens.length - 1];
    if (last?.kind === 'plain') {
      last.text += s;
    } else {
      tokens.push({ kind: 'plain', text: s });
    }
  };

  while (i < n) {
    const ch = text[i];

    // ── C-style block comment /* ... */
    if (C_COMMENT_LANGS.has(lang) && ch === '/' && text[i + 1] === '*') {
      let j = i + 2;
      while (j < n - 1 && !(text[j] === '*' && text[j + 1] === '/')) j++;
      j += 2;
      tokens.push({ kind: 'comment', text: text.slice(i, j) });
      i = j;
      continue;
    }

    // ── C-style line comment // ...
    if (C_COMMENT_LANGS.has(lang) && ch === '/' && text[i + 1] === '/') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      tokens.push({ kind: 'comment', text: text.slice(i, j) });
      i = j;
      continue;
    }

    // ── HTML/XML comment <!-- ... -->
    if (
      (lang === 'html' || lang === 'xml') &&
      ch === '<' &&
      text[i + 1] === '!' &&
      text[i + 2] === '-' &&
      text[i + 3] === '-'
    ) {
      let j = i + 4;
      while (j < n - 2 && !(text[j] === '-' && text[j + 1] === '-' && text[j + 2] === '>')) j++;
      j += 3;
      tokens.push({ kind: 'comment', text: text.slice(i, j) });
      i = j;
      continue;
    }

    // ── Hash line comment # ...
    if (HASH_COMMENT_LANGS.has(lang) && ch === '#') {
      let j = i;
      while (j < n && text[j] !== '\n') j++;
      tokens.push({ kind: 'comment', text: text.slice(i, j) });
      i = j;
      continue;
    }

    // ── String / template literal
    if (ch === '"' || ch === "'" || ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        } // escaped char
        if (text[j] === ch) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ kind: 'string', text: text.slice(i, j) });
      i = j;
      continue;
    }

    // ── Number literal
    if (/\d/.test(ch) && (i === 0 || !isIdChar(text[i - 1]))) {
      let j = i;
      while (j < n && (/[\d_]/.test(text[j]) || (text[j] === '.' && /\d/.test(text[j + 1] ?? ''))))
        j++;
      // hex / binary literals
      if (text[i] === '0' && (text[i + 1] === 'x' || text[i + 1] === 'b')) {
        j = i + 2;
        while (j < n && /[0-9a-fA-F_]/.test(text[j])) j++;
      }
      tokens.push({ kind: 'number', text: text.slice(i, j) });
      i = j;
      continue;
    }

    // ── Identifier or keyword
    if (isIdStart(ch)) {
      let j = i;
      while (j < n && isIdChar(text[j])) j++;
      const word = text.slice(i, j);
      tokens.push({ kind: keywordSet.has(word) ? 'keyword' : 'plain', text: word });
      i = j;
      continue;
    }

    // ── Plain character (punctuation, whitespace, newline …)
    pushPlain(ch);
    i++;
  }

  return tokens;
}

// ─── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Convert a token list to an HTML string with inline colour spans.
 * Each token's text is HTML-escaped before wrapping.
 *
 * @param tokens - Ordered token list / トークンリスト
 * @returns HTML string / HTML文字列
 */
function renderTokens(tokens: Token[]): string {
  return tokens
    .map(({ kind, text }) => {
      const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const style = TOKEN_STYLE[kind];
      return style ? `<span style="${style}">${escaped}</span>` : escaped;
    })
    .join('');
}

// ─── Public API ───────────────────────────────────────────────────────────────

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

/**
 * Return the caret's character offset within `el`'s entire text content.
 * Works correctly when `el` contains nested `<span>` elements (highlighted code).
 *
 * @param el - The contenteditable element containing the caret / キャレットを含む要素
 * @returns Character offset from the start of el / 開始からの文字オフセット
 */
export function getCursorOffset(el: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const pre = document.createRange();
  pre.selectNodeContents(el);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
}

/**
 * Restore the caret to a character offset within `el`.
 * Works correctly when `el` contains nested `<span>` elements (highlighted code).
 *
 * @param el - The contenteditable element / キャレットを設定する要素
 * @param offset - Character offset from the start of el / 設定する文字オフセット
 */
export function setCursorOffset(el: HTMLElement, offset: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  let remaining = offset;
  let placed = false;

  function walk(node: Node): void {
    if (placed) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node.textContent ?? '').length;
      if (remaining <= len) {
        range.setStart(node, remaining);
        range.collapse(true);
        placed = true;
      } else {
        remaining -= len;
      }
    } else {
      for (const child of Array.from(node.childNodes)) {
        walk(child);
        if (placed) return;
      }
    }
  }

  walk(el);
  if (!placed) {
    // Offset was past the end — place caret at the very end
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
