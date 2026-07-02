/**
 * code-block-elements
 *
 * DOM-element builders for the code block's chrome: the line-number gutter,
 * collapse toggle, description area, copy/delete buttons, and the language dot
 * colour map. Pure construction/wiring — no top-level block assembly here.
 */

/**
 * Localized strings for the code-block chrome (collapse toggle, description
 * placeholder, copy/delete buttons, initial code placeholder). Supplied by the
 * React layer (useNoteEditor) via `useTranslations('notes')`, since these
 * modules build raw DOM and have no hook access themselves.
 */
export interface CodeBlockLabels {
  /** Collapse/expand chevron button title. */
  collapseToggleTitle: string;
  /** Placeholder shown in the block's (initially hidden) description area. */
  descPlaceholder: string;
  /** Copy button default text. */
  copyButtonText: string;
  /** Copy button text shown briefly after a successful copy. */
  copyButtonDoneText: string;
  /** Delete button title. */
  deleteButtonTitle: string;
  /** Placeholder text shown in a freshly created empty code block. */
  codePlaceholder: string;
}

/**
 * Tracks the active MutationObserver per code element.
 * Prevents observer accumulation when normalizeCodeBlocks runs multiple times
 * on the same element — each new observer disconnects the previous one.
 */
const lineNumberObservers = new WeakMap<HTMLElement, MutationObserver>();

/** Language-to-colour map used for the dot indicator in the header. */
const LANG_COLORS: Record<string, string> = {
  javascript: '#f0db4f',
  typescript: '#3178c6',
  python: '#ffd43b',
  html: '#e34f26',
  css: '#1572b6',
  scss: '#c6538c',
  json: '#8bc4f5',
  sql: '#336791',
  go: '#00add8',
  rust: '#dea584',
  java: '#ed8b00',
  csharp: '#9b4f96',
  cpp: '#00589d',
  c: '#a8b9cc',
  ruby: '#cc342d',
  php: '#777bb4',
  swift: '#fa7343',
  kotlin: '#7f52ff',
  bash: '#4eaa25',
  shell: '#4eaa25',
  powershell: '#012456',
  yaml: '#cb171e',
  xml: '#0060ac',
  markdown: '#083fa1',
};

/**
 * Returns the dot indicator colour for a given language.
 *
 * @param language - Language identifier / 言語識別子
 * @returns CSS colour string / CSSカラー文字列
 */
export function getLangColor(language: string): string {
  return LANG_COLORS[language] ?? '#4ade80';
}

/**
 * Build the line-number gutter element.
 *
 * @returns Configured gutter div / 行番号ガター要素
 */
function buildLineNumbersEl(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'code-line-numbers';
  el.setAttribute('aria-hidden', 'true');
  el.style.userSelect = 'none';
  el.style.pointerEvents = 'none';
  el.style.padding = '14px 12px 14px 14px';
  el.style.color = '#4a4a4a';
  el.style.fontFamily = "Consolas, Monaco, 'Courier New', monospace";
  el.style.fontSize = '13.5px';
  el.style.lineHeight = '1.65';
  el.style.textAlign = 'right';
  el.style.borderRight = '1px solid #3c3c3c';
  el.style.minWidth = '2ch';
  el.style.flexShrink = '0';
  el.style.whiteSpace = 'pre';
  el.style.overflowY = 'hidden';
  return el;
}

/**
 * Recompute and render line numbers into the gutter.
 *
 * @param gutterEl - The line-number gutter element / 行番号ガター要素
 * @param codeElement - The contenteditable code element / コード要素
 */
function refreshLineNumbers(gutterEl: HTMLElement, codeElement: HTMLElement): void {
  const text = codeElement.textContent ?? '';
  const count = text === '' ? 1 : text.split('\n').length;
  gutterEl.textContent = Array.from({ length: count }, (_, i) => String(i + 1)).join('\n');
}

/**
 * Build the chevron toggle button for collapsing/expanding the code block.
 *
 * @param labels - Localized strings for the button title / ボタンタイトルの多言語文字列
 * @returns Configured toggle button / 折りたたみトグルボタン
 */
export function buildCollapseToggle(labels: CodeBlockLabels): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.dataset.collapseToggle = '1';
  btn.style.backgroundColor = 'transparent';
  btn.style.border = 'none';
  btn.style.color = '#6e6e6e';
  btn.style.cursor = 'pointer';
  btn.style.padding = '0 2px';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.style.flexShrink = '0';
  btn.style.transition = 'color 0.15s';
  btn.title = labels.collapseToggleTitle;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.style.transition = 'transform 0.2s ease';

  const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  polyline.setAttribute('points', '6 9 12 15 18 9');
  svg.appendChild(polyline);
  btn.appendChild(svg);

  btn.onmouseover = () => {
    btn.style.color = '#d4d4d4';
  };
  btn.onmouseout = () => {
    btn.style.color = '#6e6e6e';
  };

  return btn;
}

/**
 * Build the description area shown when the block is collapsed.
 * Uses the CSS placeholder pattern (.code-block-desc:empty::before) defined in globals.css.
 *
 * @param labels - Localized strings for the placeholder text / プレースホルダーの多言語文字列
 * @returns Description div element / 説明エリア要素
 */
export function buildDescEl(labels: CodeBlockLabels): HTMLElement {
  const el = document.createElement('div');
  el.className = 'code-block-desc';
  el.contentEditable = 'true';
  el.spellcheck = false;
  el.setAttribute('placeholder', labels.descPlaceholder);
  el.style.padding = '10px 18px';
  el.style.fontFamily = "Consolas, Monaco, 'Courier New', monospace";
  el.style.fontSize = '12px';
  el.style.lineHeight = '1.6';
  el.style.color = '#858585';
  el.style.outline = 'none';
  el.style.display = 'none'; // hidden by default (block starts expanded)
  el.style.minHeight = '2.4em';
  el.style.whiteSpace = 'pre-wrap';
  el.style.wordBreak = 'break-all';
  return el;
}

/**
 * Wire the collapse toggle button to show/hide the code area and description,
 * and update the chevron rotation. Re-calling this function is idempotent
 * (each call replaces the previous onclick handler).
 *
 * @param container - The outer code-block container / コードブロックのルート要素
 * @param toggleBtn - The chevron button / 折りたたみボタン
 * @param pre - The code/pre area to hide when collapsed / コードエリア
 * @param descEl - The description area to show when collapsed / 説明エリア
 */
export function attachCollapseToggle(
  container: HTMLElement,
  toggleBtn: HTMLButtonElement,
  pre: HTMLElement,
  descEl: HTMLElement,
): void {
  const apply = (collapsed: boolean) => {
    container.dataset.collapsed = String(collapsed);
    pre.style.display = collapsed ? 'none' : 'flex';
    descEl.style.display = collapsed ? 'block' : 'none';
    const svg = toggleBtn.querySelector('svg');
    if (svg) (svg as SVGElement).style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  };

  // Restore persisted state on page load / re-normalize
  apply(container.dataset.collapsed === 'true');

  toggleBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    apply(container.dataset.collapsed !== 'true');
  };
}

/**
 * Attach a MutationObserver-driven line number gutter to the pre+code pair.
 * Removes any stale gutter first so re-running `normalizeCodeBlocks` is idempotent.
 * MutationObserver captures ALL content changes (typing, paste, Enter, Tab, delete)
 * without needing per-handler event dispatching.
 *
 * @param preEl - The `<pre>` wrapper (must already be display:flex) / preラッパー要素
 * @param codeElement - The contenteditable code element / コード要素
 */
export function attachLineNumbers(preEl: HTMLElement, codeElement: HTMLElement): void {
  // Disconnect any stale observer for this element before creating a new one.
  // Without this, each normalizeCodeBlocks call accumulates an extra observer
  // that keeps firing on every keystroke, degrading performance over time.
  lineNumberObservers.get(codeElement)?.disconnect();

  // Remove stale gutter (present when re-normalizing or loading from saved HTML)
  preEl.querySelectorAll('.code-line-numbers').forEach((n) => n.remove());

  const gutterEl = buildLineNumbersEl();
  preEl.insertBefore(gutterEl, codeElement);
  refreshLineNumbers(gutterEl, codeElement);

  const observer = new MutationObserver(() => refreshLineNumbers(gutterEl, codeElement));
  observer.observe(codeElement, { childList: true, subtree: true, characterData: true });
  lineNumberObservers.set(codeElement, observer);
}

/**
 * Build and return the copy button element.
 *
 * @param codeElement - Code element whose text will be copied / コピー元コード要素
 * @param labels - Localized strings for the button text / ボタン文言の多言語文字列
 * @returns Configured copy button / コピーボタン要素
 */
export function buildCopyButton(
  codeElement: HTMLElement,
  labels: CodeBlockLabels,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = labels.copyButtonText;
  btn.style.padding = '3px 10px';
  btn.style.fontSize = '11px';
  btn.style.fontFamily = 'sans-serif';
  btn.style.backgroundColor = '#3c3c3c';
  btn.style.color = '#9d9d9d';
  btn.style.border = '1px solid #555';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'all 0.15s';
  btn.style.lineHeight = '1.4';
  btn.onmouseover = () => {
    btn.style.backgroundColor = '#505050';
    btn.style.color = '#d4d4d4';
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = '#3c3c3c';
    btn.style.color = '#9d9d9d';
  };
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const codeText = codeElement.textContent ?? '';
    navigator.clipboard.writeText(codeText).then(() => {
      const originalText = btn.textContent;
      btn.textContent = labels.copyButtonDoneText;
      btn.style.backgroundColor = '#1a3d1a';
      btn.style.color = '#6fbf6f';
      btn.style.borderColor = '#2d6b2d';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = '#3c3c3c';
        btn.style.color = '#9d9d9d';
        btn.style.borderColor = '#555';
      }, 2000);
    });
  };
  return btn;
}

/**
 * Build and return the delete button element (SVG trash icon).
 * The actual deletion handler must be attached by the caller after insertion.
 *
 * @param labels - Localized strings for the button title / ボタンタイトルの多言語文字列
 * @returns Delete button marked with data-delete-handler="1" / 削除ボタン要素
 */
export function buildDeleteButton(labels: CodeBlockLabels): HTMLButtonElement {
  const btn = document.createElement('button');

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('width', '13');
  svg.setAttribute('height', '13');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path1.setAttribute(
    'd',
    'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z',
  );
  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'M10 11v6M14 11v6');

  svg.appendChild(path1);
  svg.appendChild(path2);
  btn.appendChild(svg);

  btn.style.padding = '3px 6px';
  btn.style.backgroundColor = 'transparent';
  btn.style.color = '#6e6e6e';
  btn.style.border = '1px solid transparent';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'all 0.15s';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.title = labels.deleteButtonTitle;
  btn.dataset.deleteHandler = '1';
  btn.onmouseover = () => {
    btn.style.backgroundColor = '#3d1010';
    btn.style.color = '#f87171';
    btn.style.borderColor = '#5a1a1a';
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = 'transparent';
    btn.style.color = '#6e6e6e';
    btn.style.borderColor = 'transparent';
  };

  return btn;
}
