/**
 * html-to-markdown
 *
 * Converts a note body written by the old desktop rich editor (HTML) into
 * Markdown, for "Markdown に変換して編集" (design §5.3, Q2 (a)). The result
 * is shown to the user before anything is saved, because fonts and borders
 * are lost; text colour, highlight, font size and underline stay as the
 * allowed inline HTML (inline-html/).
 *
 * Covers what the editor writes: headings, paragraphs / divs / line breaks,
 * bold, italic, strike, inline code, code blocks, Mermaid diagram blocks,
 * links, images, lists (nested, checklists), quotes, rules and tables.
 * `domToMarkdown` is also the WYSIWYG surface's writer.
 * Not responsible for deciding which notes are HTML (note-content-kind).
 */
import DOMPurify from 'dompurify';
import {
  inlineStylesOf,
  mergeStyles,
  wrapInlineStyles,
  type InlineStyles,
} from './inline-html/inline-style';

const BLOCK_TAGS = new Set([
  'P',
  'DIV',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'PRE',
  'TABLE',
  'HR',
]);

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName);
}

function isBlankText(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() === '';
}

/**
 * An element's allowed inline styles merged down a chain of single styled
 * children (`<span color><span size>x</span></span>`), and the nodes that
 * chain finally holds — so the forms are written once, in canonical order.
 */
function styledChain(el: Element): { styles: InlineStyles; nodes: Node[] } | null {
  let styles = inlineStylesOf(el);
  if (!styles) return null;
  let nodes = Array.from(el.childNodes);
  for (;;) {
    const meaningful = nodes.filter((n) => !isBlankText(n));
    const only = meaningful.length === 1 ? meaningful[0] : null;
    const innerStyles =
      only && only.nodeType === Node.ELEMENT_NODE ? inlineStylesOf(only as Element) : null;
    if (!only || !innerStyles) return { styles, nodes };
    styles = mergeStyles(styles, innerStyles);
    nodes = Array.from(only.childNodes);
  }
}

/**
 * A Markdown mark (`**`, `*`, `~~`) around nodes. When the mark holds only
 * one styled element, the allowed form goes outside the mark: `前**<span>x</span>**後`
 * is not emphasis in CommonMark (the `<` is punctuation next to a letter),
 * `前<span>**x**</span>後` is.
 * FIXME: a mark that only partly overlaps a styled run (`**a<span>b</span>**`)
 * keeps the form inside; CommonMark may then not read the mark.
 */
function marked(nodes: Node[], mark: string): string {
  const meaningful = nodes.filter((n) => !isBlankText(n));
  const only = meaningful.length === 1 ? meaningful[0] : null;
  const chain = only && only.nodeType === Node.ELEMENT_NODE ? styledChain(only as Element) : null;
  if (chain) return wrapInlineStyles(chain.styles, marked(chain.nodes, mark));
  const text = nodes.map(inline).join('').trim();
  return text ? `${mark}${text}${mark}` : '';
}

/** Inline content of an element as Markdown, on one logical line. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse the editor's layout whitespace; non-breaking spaces become
    // spaces; the editor's zero-width caret anchors are dropped.
    return (node.textContent ?? '')
      .replace(/ /g, ' ')
      .replace(/​/g, '')
      .replace(/[ \t\r\n]+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const inner = () => Array.from(el.childNodes).map(inline).join('');
  switch (el.tagName) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B':
      return marked(Array.from(el.childNodes), '**');
    case 'EM':
    case 'I':
      return marked(Array.from(el.childNodes), '*');
    case 'S':
    case 'STRIKE':
    case 'DEL':
      return marked(Array.from(el.childNodes), '~~');
    case 'INPUT':
      // A checklist box is written by its list item, not inline.
      return '';
    case 'CODE':
      return `\`${el.textContent ?? ''}\``;
    case 'A': {
      const href = el.getAttribute('href') ?? '';
      const text = inner().trim() || href;
      return href ? `[${text}](${href})` : text;
    }
    case 'IMG': {
      const src = el.getAttribute('src') ?? '';
      return src ? `![${el.getAttribute('alt') ?? ''}](${src})` : '';
    }
    default: {
      // span, font, mark, u: colour, highlight, size and underline stay as
      // the allowed inline forms; fonts, borders and the rest are dropped.
      const chain = styledChain(el);
      return chain ? wrapInlineStyles(chain.styles, chain.nodes.map(inline).join('')) : inner();
    }
  }
}

function checkboxOf(li: Element): HTMLInputElement | null {
  const first = Array.from(li.childNodes).find((n) => !isBlankText(n));
  if (!first || first.nodeType !== Node.ELEMENT_NODE) return null;
  const el = first as HTMLInputElement;
  return el.tagName === 'INPUT' && el.getAttribute('type')?.toLowerCase() === 'checkbox'
    ? el
    : null;
}

function list(el: Element, depth: number): string[] {
  const ordered = el.tagName === 'OL';
  const lines: string[] = [];
  let index = 1;
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'LI') continue;
    const box = checkboxOf(child);
    const task = box ? (box.checked ? ' [x]' : ' [ ]') : '';
    const marker = (ordered ? `${index++}.` : '-') + task;
    const pad = '  '.repeat(depth);
    const text = Array.from(child.childNodes)
      .filter(
        (n) => !(n.nodeType === Node.ELEMENT_NODE && ['UL', 'OL'].includes((n as Element).tagName)),
      )
      .map(inline)
      .join('')
      .trim();
    lines.push(`${pad}${marker} ${text}`);
    for (const nested of Array.from(child.children)) {
      if (nested.tagName === 'UL' || nested.tagName === 'OL')
        lines.push(...list(nested, depth + 1));
    }
  }
  return lines;
}

function table(el: Element): string {
  const rows = Array.from(el.querySelectorAll('tr')).map((tr) =>
    Array.from(tr.children).map((cell) => inline(cell).trim().replace(/\|/g, '\\|')),
  );
  if (rows.length === 0) return '';
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill('')];
  const line = (r: string[]) => `| ${pad(r).join(' | ')} |`;
  const [head, ...body] = rows;
  return [line(head ?? []), `| ${Array(width).fill('---').join(' | ')} |`, ...body.map(line)].join(
    '\n',
  );
}

/** One block element as Markdown (may be several lines). */
function block(el: Element): string {
  if (el.classList.contains('diagram-block')) {
    const source = el.querySelector('.diagram-source')?.textContent?.trim() ?? '';
    return source ? '```mermaid\n' + source + '\n```' : '';
  }
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) {
    const text = inline(el).trim();
    return text ? `${'#'.repeat(Number(tag[1]))} ${text}` : '';
  }
  switch (tag) {
    case 'UL':
    case 'OL':
      return list(el, 0).join('\n');
    case 'BLOCKQUOTE':
      return blocks(el)
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n');
    case 'PRE': {
      const code = el.querySelector('code');
      const lang = (code?.className.match(/language-([\w-]+)/) ?? [])[1] ?? '';
      const text = (code ?? el).textContent ?? '';
      return '```' + lang + '\n' + text.replace(/\n$/, '') + '\n```';
    }
    case 'TABLE':
      return table(el);
    case 'HR':
      return '---';
    default:
      // p / div: a container of inline content, or of further blocks.
      return Array.from(el.childNodes).some(isBlock) ? blocks(el) : inline(el).trim();
  }
}

/** The children of a container, blocks separated by blank lines. */
function blocks(container: Node): string {
  const parts: string[] = [];
  let run = '';
  const flush = () => {
    const text = run.trim();
    if (text) parts.push(text);
    run = '';
  };
  for (const child of Array.from(container.childNodes)) {
    if (isBlock(child)) {
      flush();
      const md = block(child as Element);
      if (md) parts.push(md);
    } else {
      run += inline(child);
    }
  }
  flush();
  return parts.join('\n\n');
}

/**
 * Convert rich-editor HTML to Markdown.
 *
 * @param html - The legacy note body / 旧エディタの本文（HTML）
 * @returns Markdown text / Markdown の本文
 */
export function htmlToMarkdown(html: string): string {
  const clean = DOMPurify.sanitize(html);
  const doc = new DOMParser().parseFromString(`<body>${clean}</body>`, 'text/html');
  return domToMarkdown(doc.body);
}

/**
 * Write the contents of a trusted DOM container (e.g. the WYSIWYG surface)
 * as Markdown.
 *
 * @param root - The container whose children are the note / ノート本体を子に持つ要素
 * @returns Markdown text / Markdown の本文
 */
export function domToMarkdown(root: Node): string {
  return (
    blocks(root)
      // An empty editor line (<div><br></div>) becomes a blank line, not three.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
