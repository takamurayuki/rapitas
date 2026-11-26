/**
 * wysiwyg-blocks
 *
 * Block structure of the note WYSIWYG surface: which top-level block holds
 * the selection, wrapping a bare typed line in a paragraph, inserting after
 * the current block, and turning a line into a checklist item and back.
 * Not responsible for inline styling; see wysiwyg-commands.ts.
 */
/**
 * The selection's range when it lies inside the surface, else null.
 *
 * @param root - The surface / 編集面
 * @returns The range, or null / 範囲、編集面の外なら null
 */
export function rangeIn(root: HTMLElement): Range | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return root.contains(range.commonAncestorContainer) ? range : null;
}

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

function isBlockElement(node: Node | null): boolean {
  return node?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName);
}

/** The surface's top-level child (element or text) holding the selection start. */
function topNode(root: HTMLElement, range: Range | null): ChildNode | null {
  if (!range) return null;
  let node: Node | null = range.startContainer;
  if (node === root) {
    node = root.childNodes[range.startOffset] ?? root.childNodes[range.startOffset - 1] ?? null;
  }
  while (node && node.parentNode !== root) node = node.parentNode;
  return node as ChildNode | null;
}

/**
 * The top-level block holding the selection. A line typed straight into the
 * surface (text with no paragraph around it, as an empty contentEditable
 * starts) is first wrapped in a <p>, together with the inline nodes next to it.
 */
function ensureBlock(root: HTMLElement, range: Range | null): Element | null {
  const node = topNode(root, range);
  if (!node) return null;
  if (isBlockElement(node)) return node as Element;
  let first: ChildNode = node;
  let last: ChildNode = node;
  while (first.previousSibling && !isBlockElement(first.previousSibling)) {
    first = first.previousSibling;
  }
  while (last.nextSibling && !isBlockElement(last.nextSibling)) last = last.nextSibling;
  const p = document.createElement('p');
  first.before(p);
  let current: ChildNode | null = first;
  while (current) {
    const next: ChildNode | null = current === last ? null : current.nextSibling;
    p.appendChild(current);
    current = next;
  }
  return p;
}

/** Insert `node` after the block (or bare line) holding the selection, or at the end. */
export function insertAfterBlock(root: HTMLElement, node: Node): void {
  const top = topNode(root, rangeIn(root));
  if (top) top.after(node);
  else root.appendChild(node);
}

function checkbox(): HTMLInputElement {
  const box = document.createElement('input');
  box.type = 'checkbox';
  return box;
}

/**
 * Make the current line a checklist item, or a checklist item plain again.
 *
 * @param root - The surface / 編集面
 * @returns true when something changed / 変更したら true
 */
export function toggleChecklist(root: HTMLElement): boolean {
  const range = rangeIn(root);
  if (!range) return false;
  const start =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? (range.startContainer as Element)
      : range.startContainer.parentElement;
  const li = start?.closest('li');
  if (li && root.contains(li)) {
    const box = li.querySelector(':scope > input[type="checkbox"]');
    if (!box) {
      li.prepend(checkbox());
      return true;
    }
    box.remove();
    const list = li.parentElement;
    // A one-item list becomes a plain paragraph; a longer one keeps its bullet.
    if (list && list.children.length === 1 && list.parentElement === root) {
      const p = document.createElement('p');
      while (li.firstChild) p.appendChild(li.firstChild);
      list.replaceWith(p);
    }
    return true;
  }
  const block = ensureBlock(root, range);
  if (!block) return false;
  const ul = document.createElement('ul');
  const item = document.createElement('li');
  item.appendChild(checkbox());
  while (block.firstChild) item.appendChild(block.firstChild);
  ul.appendChild(item);
  block.replaceWith(ul);
  return true;
}
