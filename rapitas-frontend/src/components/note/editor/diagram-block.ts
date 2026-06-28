'use client';
// diagram-block
// DOM utilities for Mermaid diagram blocks embedded in the note editor.

export const DEFAULT_DIAGRAM_SOURCE = `graph TD
    A[開始] --> B{条件分岐}
    B -- はい --> C[処理A]
    B -- いいえ --> D[処理B]
    C --> E[終了]
    D --> E`;

let _mermaidInitialized = false;

async function getMermaid() {
  const { default: mermaid } = await import('mermaid');
  if (!_mermaidInitialized) {
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
    _mermaidInitialized = true;
  }
  return mermaid;
}

let _renderId = 0;

/**
 * Renders a Mermaid diagram into the given block element.
 * Updates the .diagram-render child in-place.
 *
 * @param block - The .diagram-block wrapper element / ダイアグラムブロック要素
 */
export async function renderMermaidBlock(block: HTMLElement): Promise<void> {
  const source = block.getAttribute('data-mermaid-source');
  const renderEl = block.querySelector('.diagram-render') as HTMLElement | null;
  if (!source || !renderEl) return;

  try {
    const mermaid = await getMermaid();
    const id = `mermaid-${++_renderId}`;
    const { svg } = await mermaid.render(id, source);
    renderEl.innerHTML = svg;
  } catch (err) {
    renderEl.innerHTML = `<div class="diagram-error">⚠ 構文エラー: Mermaidの記法を確認してください</div>`;
  }
}

/**
 * Renders all diagram blocks inside a container and ensures non-editable.
 *
 * @param container - The editor's contentEditable div
 */
export async function renderAllDiagrams(container: HTMLElement): Promise<void> {
  const blocks = Array.from(
    container.querySelectorAll('.diagram-block[data-mermaid-source]'),
  ) as HTMLElement[];
  for (const block of blocks) {
    // NOTE: DOMPurify may strip contenteditable; re-apply after sanitize.
    block.contentEditable = 'false';
    await renderMermaidBlock(block);
  }
}

/**
 * Creates a DocumentFragment with a diagram block div and a trailing paragraph.
 *
 * @param source - Initial Mermaid source / 初期Mermaidソース
 * @returns Fragment ready for insertion into contentEditable
 */
export function createDiagramBlockNode(source: string = DEFAULT_DIAGRAM_SOURCE): DocumentFragment {
  const frag = document.createDocumentFragment();

  const wrapper = document.createElement('div');
  wrapper.className = 'diagram-block';
  wrapper.contentEditable = 'false';
  wrapper.setAttribute('data-mermaid-source', source);

  const render = document.createElement('div');
  render.className = 'diagram-render';
  render.innerHTML =
    '<p class="diagram-loading" style="color:#94a3b8;font-size:0.875rem">ダイアグラムを読み込み中...</p>';
  wrapper.appendChild(render);
  frag.appendChild(wrapper);

  const trailing = document.createElement('p');
  trailing.innerHTML = '<br>';
  frag.appendChild(trailing);

  return frag;
}

/**
 * Returns the editor innerHTML with SVG stripped from diagram blocks.
 * Only data-mermaid-source is preserved; SVG is re-rendered on next load.
 *
 * @param container - The editor's contentEditable div
 * @returns Cleaned HTML ready for localStorage storage
 */
export function getContentWithoutDiagramSvg(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('.diagram-block[data-mermaid-source]').forEach((block) => {
    const render = block.querySelector('.diagram-render');
    if (render) render.innerHTML = '';
  });
  return clone.innerHTML;
}
