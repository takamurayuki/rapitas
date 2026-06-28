'use client';
// diagram-block
// DOM utilities for Mermaid diagram blocks embedded in the note editor.
//
// NOTE: Source is stored as text content in a hidden <pre class="diagram-source">
// instead of a data-* attribute. DOMPurify preserves element text content reliably,
// but may corrupt attribute values containing Mermaid syntax (-->, {}, [], etc.).

export const DEFAULT_DIAGRAM_SOURCE = `graph TD
    A[開始] --> B{条件分岐}
    B -- はい --> C[処理A]
    B -- いいえ --> D[処理B]
    C --> E[終了]
    D --> E`;

let _mermaidInitialized = false;
let _renderId = 0;

async function getMermaid() {
  const { default: mermaid } = await import('mermaid');
  if (!_mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
    _mermaidInitialized = true;
  }
  return mermaid;
}

/**
 * Returns the Mermaid source stored in a diagram block's .diagram-source child.
 *
 * @param block - The .diagram-block wrapper element
 */
export function getDiagramSource(block: HTMLElement): string {
  return block.querySelector('.diagram-source')?.textContent ?? '';
}

/**
 * Updates the Mermaid source stored in a diagram block's .diagram-source child.
 *
 * @param block - The .diagram-block wrapper element
 * @param source - New Mermaid source code
 */
export function setDiagramSource(block: HTMLElement, source: string): void {
  const el = block.querySelector('.diagram-source') as HTMLElement | null;
  if (el) el.textContent = source;
}

/**
 * Renders a Mermaid diagram SVG into the .diagram-render child of a block.
 * Reads source from .diagram-source text content.
 *
 * @param block - The .diagram-block wrapper element
 */
export async function renderMermaidBlock(block: HTMLElement): Promise<void> {
  const source = getDiagramSource(block).trim();
  const renderEl = block.querySelector('.diagram-render') as HTMLElement | null;
  if (!source || !renderEl) return;

  try {
    const mermaid = await getMermaid();
    const id = `mermaid-${++_renderId}`;
    const { svg } = await mermaid.render(id, source);
    renderEl.innerHTML = svg;
  } catch {
    renderEl.innerHTML = `<div class="diagram-error">⚠ 構文エラー — Mermaidの記法を確認してください</div>`;
  }
}

/**
 * Re-applies contenteditable=false and renders all diagram blocks in a container.
 * Called after DOMPurify sanitization, which may strip the contenteditable attribute.
 *
 * @param container - The editor's contentEditable div
 */
export async function renderAllDiagrams(container: HTMLElement): Promise<void> {
  const blocks = Array.from(container.querySelectorAll('.diagram-block')) as HTMLElement[];
  for (const block of blocks) {
    block.contentEditable = 'false';
    await renderMermaidBlock(block);
  }
}

/**
 * Creates a DocumentFragment with a diagram block and a trailing paragraph.
 *
 * Structure:
 *   div.diagram-block[contenteditable=false]
 *     button.diagram-delete-btn   ← shown on hover via CSS
 *     div.diagram-render          ← Mermaid SVG target
 *     pre.diagram-source          ← hidden; text content is the source of truth
 *   p                             ← trailing cursor target
 *
 * @param source - Initial Mermaid source / 初期Mermaidソース
 * @returns Fragment ready for insertion into contentEditable
 */
export function createDiagramBlockNode(source: string = DEFAULT_DIAGRAM_SOURCE): DocumentFragment {
  const frag = document.createDocumentFragment();

  const wrapper = document.createElement('div');
  wrapper.className = 'diagram-block';
  wrapper.contentEditable = 'false';

  const delBtn = document.createElement('button');
  delBtn.className = 'diagram-delete-btn';
  delBtn.title = 'ダイアグラムを削除';
  delBtn.textContent = '×';
  wrapper.appendChild(delBtn);

  const renderEl = document.createElement('div');
  renderEl.className = 'diagram-render';
  renderEl.innerHTML =
    '<p style="color:#94a3b8;font-size:0.875rem;margin:0">ダイアグラムを読み込み中...</p>';
  wrapper.appendChild(renderEl);

  // Source stored as text content — survives DOMPurify attribute sanitization
  const sourceEl = document.createElement('pre');
  sourceEl.className = 'diagram-source';
  sourceEl.textContent = source;
  wrapper.appendChild(sourceEl);

  frag.appendChild(wrapper);

  const trailing = document.createElement('p');
  trailing.innerHTML = '<br>';
  frag.appendChild(trailing);

  return frag;
}

/**
 * Returns the editor innerHTML with Mermaid SVGs stripped from diagram blocks.
 * The .diagram-source pre is preserved so diagrams survive the save/load cycle.
 *
 * @param container - The editor's contentEditable div
 * @returns Cleaned HTML ready for localStorage storage
 */
export function getContentWithoutDiagramSvg(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.diagram-block').forEach((block) => {
    const render = block.querySelector('.diagram-render');
    if (render) render.innerHTML = '';
  });
  return clone.innerHTML;
}
