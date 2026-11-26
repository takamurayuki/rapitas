/**
 * InlineHtmlTag
 *
 * Reads one HTML tag at a position of a note body and decides whether it is
 * one of the four allowed inline forms (text colour, highlight, font size,
 * underline), returning that form's canonical spelling.
 * Not responsible for pairing tags or for code; see note-inline-html.ts.
 *
 * NOTE: the frontend keeps the same rules in
 * rapitas-frontend/src/components/note/markdown-note/inline-html/inline-html-tag.ts;
 * both read note-inline-html.cases.json in their tests.
 */

/** Smallest and largest font size the allowed form accepts, in px. */
export const NOTE_FONT_SIZE_MIN = 8;
export const NOTE_FONT_SIZE_MAX = 72;

/** Tags that may pair as allowed inline forms. */
export const INLINE_PAIR_TAGS: ReadonlySet<string> = new Set(['span', 'mark', 'u']);

/** Tags whose content is code, not prose: removed with what they hold. */
export const RAW_TEXT_TAGS: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'textarea',
  'title',
  'svg',
  'math',
]);

/** One attribute as written. */
interface TagAttribute {
  name: string;
  value: string | null;
  quoted: boolean;
}

/** A tag read from a body. */
export interface ScannedTag {
  /** Lower-cased tag name / 小文字のタグ名 */
  name: string;
  /** True for an end tag / 終了タグなら true */
  closing: boolean;
  /** The allowed form's canonical spelling, or null / 許可形の正規形（許可形でなければ null） */
  canonical: string | null;
  /** Index just past the tag's `>` / タグの `>` の直後の位置 */
  end: number;
}

// A tag starts with `<` or `</`, a letter, letters/digits/`-`, and then a
// space, `/` or `>` — so `a < b`, `<https://x>` and `<a@b.c>` stay text.
const TAG_START = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])/y;
const SPACES = /\s*/y;
const ATTR_NAME = /[^\s"'>/=<]+/y;
const UNQUOTED_VALUE = /[^\s"'=<>`]+/y;
const CLOSE_REST = /\s*>/y;
const HEX_COLOUR = /^#[0-9a-f]{6}$/i;
const PX_SIZE = /^(\d{1,2})px$/i;

function matchAt(re: RegExp, text: string, at: number): RegExpExecArray | null {
  re.lastIndex = at;
  return re.exec(text);
}

function readAttributes(
  text: string,
  from: number,
): { attrs: TagAttribute[]; selfClosing: boolean; end: number } | null {
  const attrs: TagAttribute[] = [];
  let p = from;
  for (;;) {
    // NOTE: a browser reads a lone `/` between attributes as a separator, and an
    // attribute right after a quoted value as a new attribute
    // (`<span/onmouseover=…>`, `a="x"b="y"`). Reading them the same way keeps
    // such a tag from passing as text with its handler attached.
    for (;;) {
      const spaces = matchAt(SPACES, text, p)?.[0].length ?? 0;
      p += spaces;
      if (text[p] === '/' && text[p + 1] !== '>' && p + 1 < text.length) {
        p += 1;
        continue;
      }
      break;
    }
    if (p >= text.length) return null;
    if (text[p] === '>') return { attrs, selfClosing: false, end: p + 1 };
    if (text.startsWith('/>', p)) return { attrs, selfClosing: true, end: p + 2 };
    const name = matchAt(ATTR_NAME, text, p)?.[0];
    if (!name) return null;
    p += name.length;
    const beforeEquals = p;
    p += matchAt(SPACES, text, p)?.[0].length ?? 0;
    if (text[p] !== '=') {
      attrs.push({ name, value: null, quoted: false });
      p = beforeEquals;
      continue;
    }
    p += 1;
    p += matchAt(SPACES, text, p)?.[0].length ?? 0;
    const quote = text[p];
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, p + 1);
      if (close < 0) return null;
      attrs.push({ name, value: text.slice(p + 1, close), quoted: true });
      p = close + 1;
      continue;
    }
    const value = matchAt(UNQUOTED_VALUE, text, p)?.[0];
    if (!value) return null;
    attrs.push({ name, value, quoted: false });
    p += value.length;
  }
}

/** The one `prop:value` of a style attribute, or null when it is not exactly one. */
function singleDeclaration(style: string): { prop: string; value: string } | null {
  let body = style.trim();
  if (body.endsWith(';')) body = body.slice(0, -1).trim();
  if (body.includes(';')) return null;
  const colon = body.indexOf(':');
  if (colon < 0) return null;
  return {
    prop: body.slice(0, colon).trim().toLowerCase(),
    value: body.slice(colon + 1).trim(),
  };
}

/**
 * The canonical start tag of an allowed form, or null when the tag is not one.
 *
 * @param name - Lower-cased tag name / 小文字のタグ名
 * @param attrs - Its attributes / 属性
 * @param selfClosing - Whether it ended in `/>` / `/>` で閉じていたか
 * @returns The canonical start tag or null / 正規形の開始タグ、許可形でなければ null
 */
function canonicalStart(name: string, attrs: TagAttribute[], selfClosing: boolean): string | null {
  if (selfClosing) return null;
  if (name === 'u') return attrs.length === 0 ? '<u>' : null;
  if (name !== 'span' && name !== 'mark') return null;
  const [attr] = attrs;
  if (attrs.length !== 1 || !attr || attr.name.toLowerCase() !== 'style') return null;
  if (attr.value === null || !attr.quoted) return null;
  const decl = singleDeclaration(attr.value);
  if (!decl) return null;
  if (name === 'mark') {
    if (decl.prop !== 'background-color' || !HEX_COLOUR.test(decl.value)) return null;
    return `<mark style="background-color:${decl.value.toUpperCase()}">`;
  }
  if (decl.prop === 'color' && HEX_COLOUR.test(decl.value)) {
    return `<span style="color:${decl.value.toUpperCase()}">`;
  }
  const size = decl.prop === 'font-size' ? PX_SIZE.exec(decl.value) : null;
  if (size) {
    const px = Number(size[1]);
    if (px >= NOTE_FONT_SIZE_MIN && px <= NOTE_FONT_SIZE_MAX) {
      return `<span style="font-size:${px}px">`;
    }
  }
  return null;
}

/**
 * Read the tag that starts at `at`, if one does.
 *
 * @param text - The text to read / 読む文字列
 * @param at - Index of a `<` / `<` の位置
 * @returns The tag, or null when the `<` does not start a whole tag / タグ、タグでなければ null
 */
export function scanTagAt(text: string, at: number): ScannedTag | null {
  const start = matchAt(TAG_START, text, at);
  if (!start) return null;
  const closing = start[1] === '/';
  const name = (start[2] ?? '').toLowerCase();
  const after = at + start[0].length;
  if (closing) {
    const rest = matchAt(CLOSE_REST, text, after);
    if (!rest) return null;
    const canonical = INLINE_PAIR_TAGS.has(name) ? `</${name}>` : null;
    return { name, closing, canonical, end: after + rest[0].length };
  }
  const read = readAttributes(text, after);
  if (!read) return null;
  return {
    name,
    closing,
    canonical: canonicalStart(name, read.attrs, read.selfClosing),
    end: read.end,
  };
}

/**
 * Whether `<` at `at` begins like a tag (`<name` followed by a space, `/` or
 * `>`), even when the rest cannot be read as one.
 *
 * @param text - The text to read / 読む文字列
 * @param at - Index of a `<` / `<` の位置
 * @returns true when it starts like a tag / タグの始まりに見えれば true
 */
export function looksLikeTagAt(text: string, at: number): boolean {
  return matchAt(TAG_START, text, at) !== null;
}

/**
 * Read a string that is exactly one span / mark / u tag (a Markdown parser's
 * html node).
 *
 * @param raw - The whole tag / タグ全体の文字列
 * @returns Name, end-tag flag and canonical form, or null / 名前・終了タグか・正規形。span/mark/u のタグ1個でなければ null
 */
export function parseInlineHtmlTag(
  raw: string,
): { name: string; closing: boolean; canonical: string | null } | null {
  const tag = scanTagAt(raw, 0);
  if (!tag || tag.end !== raw.length || !INLINE_PAIR_TAGS.has(tag.name)) return null;
  return { name: tag.name, closing: tag.closing, canonical: tag.canonical };
}
