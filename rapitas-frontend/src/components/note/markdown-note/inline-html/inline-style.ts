/**
 * inline-style
 *
 * Reads the styling of one DOM element (the old rich editor's span / font /
 * mark / u, or the WYSIWYG surface's own) as the allowed inline forms, and
 * writes text wrapped in them in the canonical order.
 * Not responsible for walking the DOM; see html-to-markdown.ts.
 */
import { NOTE_FONT_SIZE_MAX, NOTE_FONT_SIZE_MIN } from './inline-html-tag';

/** The allowed inline forms an element carries. */
export interface InlineStyles {
  /** Font size in px, 8..72 / 文字サイズ（px） */
  fontSize?: number;
  /** Text colour as #RRGGBB / 文字色 */
  color?: string;
  /** Highlight colour as #RRGGBB / ハイライト色 */
  highlight?: string;
  /** Underline / 下線 */
  underline?: boolean;
}

const RGB = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})(?:\s*[,/]\s*([\d.]+)(%)?)?\s*\)$/i;
const HEX6 = /^#([0-9a-f]{6})$/i;
const HEX3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const COLOUR_TOKEN = /rgba?\([^)]*\)|#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/gi;
const PX = /^(\d+(?:\.\d+)?)px$/i;

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/**
 * A CSS colour as #RRGGBB, or null for a name, a transparent colour or anything else.
 *
 * @param value - A CSS colour (`rgb(…)`, `#hex`) / CSS の色
 * @returns #RRGGBB in upper case, or null / 大文字の #RRGGBB、変換できなければ null
 */
export function cssColourToHex(value: string): string | null {
  const v = value.trim();
  const six = HEX6.exec(v);
  if (six) return `#${(six[1] ?? '').toUpperCase()}`;
  const three = HEX3.exec(v);
  if (three)
    return `#${three
      .slice(1, 4)
      .map((d) => `${d}${d}`)
      .join('')
      .toUpperCase()}`;
  const rgb = RGB.exec(v);
  if (!rgb) return null;
  if (rgb[4] !== undefined && Number(rgb[4]) === 0) return null;
  const parts = [rgb[1], rgb[2], rgb[3]].map(Number);
  if (parts.some((n) => n > 255)) return null;
  return `#${parts.map(hex2).join('').toUpperCase()}`;
}

function declarations(style: string): Array<[string, string]> {
  return style
    .split(';')
    .map((d) => {
      const colon = d.indexOf(':');
      return colon < 0
        ? null
        : ([d.slice(0, colon).trim().toLowerCase(), d.slice(colon + 1).trim()] as [string, string]);
    })
    .filter((d): d is [string, string] => d !== null && d[1] !== '');
}

/** The last opaque colour of a gradient (the old editor's marker highlight). */
function gradientColour(value: string): string | null {
  const tokens = value.match(COLOUR_TOKEN) ?? [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const hex = cssColourToHex(tokens[i] ?? '');
    if (hex) return hex;
  }
  return null;
}

function fontSizePx(value: string): number | undefined {
  const px = PX.exec(value.trim());
  if (!px) return undefined;
  const n = Number(px[1]);
  return Number.isInteger(n) && n >= NOTE_FONT_SIZE_MIN && n <= NOTE_FONT_SIZE_MAX ? n : undefined;
}

/**
 * The allowed inline forms an element carries, or null when it carries none.
 *
 * Reads the `style` attribute itself (not `element.style`), so the old
 * editor's gradient highlight is seen even where the DOM cannot parse it.
 *
 * @param el - A span / font / mark / u element / 要素
 * @returns Its styles, or null / 許可形の装飾、無ければ null
 */
export function inlineStylesOf(el: Element): InlineStyles | null {
  const tag = el.tagName.toLowerCase();
  if (!['span', 'font', 'mark', 'u'].includes(tag)) return null;
  const styles: InlineStyles = {};
  if (tag === 'u') styles.underline = true;
  if (tag === 'font') {
    const colour = cssColourToHex(el.getAttribute('color') ?? '');
    if (colour) styles.color = colour;
  }
  for (const [prop, value] of declarations(el.getAttribute('style') ?? '')) {
    if (prop === 'color') {
      const colour = cssColourToHex(value);
      if (colour) styles.color = colour;
    } else if (prop === 'background-color') {
      const colour = cssColourToHex(value);
      if (colour) styles.highlight = colour;
    } else if (prop === 'background' || prop === 'background-image') {
      const colour = value.includes('gradient(') ? gradientColour(value) : cssColourToHex(value);
      if (colour) styles.highlight = colour;
    } else if (prop === 'font-size') {
      const size = fontSizePx(value);
      if (size !== undefined) styles.fontSize = size;
    } else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      if (/\bunderline\b/i.test(value)) styles.underline = true;
    }
  }
  return Object.keys(styles).length > 0 ? styles : null;
}

/**
 * Merge an inner element's styles over an outer one's (the inner one wins).
 *
 * @param outer - Outer styles / 外側
 * @param inner - Inner styles / 内側
 * @returns The merged styles / 合成した装飾
 */
export function mergeStyles(outer: InlineStyles, inner: InlineStyles): InlineStyles {
  return { ...outer, ...inner };
}

/**
 * Wrap text in the allowed forms, outermost first: font size, colour,
 * highlight, underline (the one order the phone's parser expects).
 *
 * @param styles - The forms to apply / 付ける装飾
 * @param content - Markdown text to wrap / 包む Markdown
 * @returns The wrapped text / 包んだ文字列
 */
export function wrapInlineStyles(styles: InlineStyles, content: string): string {
  if (content.trim() === '') return content;
  let out = content;
  if (styles.underline) out = `<u>${out}</u>`;
  if (styles.highlight) out = `<mark style="background-color:${styles.highlight}">${out}</mark>`;
  if (styles.color) out = `<span style="color:${styles.color}">${out}</span>`;
  if (styles.fontSize !== undefined)
    out = `<span style="font-size:${styles.fontSize}px">${out}</span>`;
  return out;
}
