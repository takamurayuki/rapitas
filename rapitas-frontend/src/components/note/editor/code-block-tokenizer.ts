/**
 * code-block-tokenizer
 *
 * Single-pass tokenizer and HTML renderer for code-block syntax highlighting.
 * Identifies strings, comments, keywords, and numbers in one traversal — avoiding
 * the conflicting-regex problem of multiple regex passes over the same HTML string.
 */

import { KEYWORDS, C_COMMENT_LANGS, HASH_COMMENT_LANGS } from './code-block-keywords';

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

export { tokenize, renderTokens };
export type { Token, TokenKind };
