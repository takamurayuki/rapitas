/**
 * html-to-markdown
 *
 * Converts a note body written by the old desktop rich editor (HTML) into
 * Markdown, for "Markdown に変換して編集" (design §5.3, Q2 (a)). The result
 * is shown to the user before anything is saved, because formatting
 * Markdown cannot express — colours, font sizes, fonts, underline — is lost.
 *
 * Covers what the editor writes: headings, paragraphs / divs / line breaks,
 * bold, italic, strike, inline code, code blocks, Mermaid diagram blocks,
 * links, images, lists (nested), quotes, rules and tables.
 * Not responsible for deciding which notes are HTML (note-content-kind).
 */
import DOMPurify from 'dompurify';

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

/** Inline content of an element as Markdown, on one logical line. */
function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    // Collapse the editor's layout whitespace; non-breaking spaces become spaces.
    return (node.textContent ?? '').replace(/ /g, ' ').replace(/[ \t\r\n]+/g, ' ');
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const inner = () => Array.from(el.childNodes).map(inline).join('');
  switch (el.tagName) {
    case 'BR':
      return '\n';
    case 'STRONG':
    case 'B': {
      const text = inner().trim();
      return text ? `**${text}**` : '';
    }
    case 'EM':
    case 'I': {
      const text = inner().trim();
      return text ? `*${text}*` : '';
    }
    case 'S':
    case 'STRIKE':
    case 'DEL': {
      const text = inner().trim();
      return text ? `~~${text}~~` : '';
    }
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
    default:
      // span, font, mark, u…: the text survives, the styling does not.
      return inner();
  }
}

function list(el: Element, depth: number): string[] {
  const ordered = el.tagName === 'OL';
  const lines: string[] = [];
  let index = 1;
  for (const child of Array.from(el.children)) {
    if (child.tagName !== 'LI') continue;
    const marker = ordered ? `${index++}.` : '-';
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
  return (
    blocks(doc.body)
      // An empty editor line (<div><br></div>) becomes a blank line, not three.
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}
