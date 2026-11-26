/**
 * remark-note-inline-html
 *
 * A remark plugin that draws the allowed inline forms of a note (text colour,
 * highlight, font size, underline): a start-tag html node and its end-tag
 * html node in the same parent become one element holding what lies between.
 * Every other html node is left alone, so react-markdown keeps not rendering
 * it (no rehype-raw: arbitrary HTML is never let through and then narrowed).
 */
import { parseInlineHtmlTag } from './inline-html-tag';

/** The slice of an mdast node this plugin reads and writes. */
interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  data?: { hName?: string; hProperties?: Record<string, string> };
}

interface OpenAt {
  index: number;
  name: string;
  canonical: string | null;
}

const STYLE_IN_CANONICAL = /style="([^"]*)"/;

function wrapperFor(name: string, canonical: string, children: MdNode[]): MdNode {
  const style = STYLE_IN_CANONICAL.exec(canonical)?.[1];
  return {
    type: 'noteInlineHtml',
    children,
    data: { hName: name, hProperties: style ? { style } : {} },
  };
}

/** Pair the html nodes of one children list, innermost pairs first. */
function pairChildren(children: MdNode[]): void {
  const stack: OpenAt[] = [];
  for (let i = 0; i < children.length; i += 1) {
    const node = children[i] as MdNode;
    if (node.type !== 'html' || typeof node.value !== 'string') continue;
    const tag = parseInlineHtmlTag(node.value.trim());
    if (!tag) continue;
    if (!tag.closing) {
      stack.push({ index: i, name: tag.name, canonical: tag.canonical });
      continue;
    }
    let k = stack.length - 1;
    while (k >= 0 && stack[k]?.name !== tag.name) k -= 1;
    if (k < 0) continue;
    const open = stack[k] as OpenAt;
    stack.length = k;
    // A disallowed start tag pairs (so it is not taken by an outer one) but
    // draws nothing: both nodes stay html and are not rendered.
    if (!open.canonical) continue;
    const inner = children.slice(open.index + 1, i);
    children.splice(open.index, i - open.index + 1, wrapperFor(open.name, open.canonical, inner));
    i = open.index;
  }
}

function visit(node: MdNode): void {
  if (!node.children) return;
  for (const child of node.children) visit(child);
  pairChildren(node.children);
}

/**
 * The remark plugin (attacher). Use only for note bodies.
 *
 * @returns The tree transformer / 木の変換関数
 */
export default function remarkNoteInlineHtml() {
  return (tree: MdNode) => {
    visit(tree);
  };
}
