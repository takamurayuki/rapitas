/**
 * code-block-dom
 *
 * DOM construction for the note editor's code blocks.
 * Responsible for building the complete code-block DocumentFragment using a
 * terminal-dark visual theme (VS Code-inspired: #1e1e1e background, #252526 header).
 *
 * Syntax highlighting strategy:
 *   - While editing (focused): plain text for clean cursor positioning.
 *   - After editing (blurred): `highlightCode()` is applied so the stored HTML
 *     contains coloured spans. This avoids cursor-inside-span edge cases during typing.
 *
 * Element/handler primitives live in `code-block-elements` and `code-block-handlers`;
 * this module orchestrates them into the full block and re-normalizes saved blocks.
 */

import { programmingLanguages } from './constants';
import { highlightCode } from './code-block-highlight';
import {
  attachKeyHandlers,
  attachHighlightHandlers,
  attachPasteHandler,
} from './code-block-handlers';
import {
  getLangColor,
  buildCollapseToggle,
  buildDescEl,
  attachCollapseToggle,
  attachLineNumbers,
  buildCopyButton,
  buildDeleteButton,
} from './code-block-elements';

// Re-export so the original import path keeps exposing the same public API.
export { attachKeyHandlers } from './code-block-handlers';

/**
 * Build a complete code-block DOM fragment with a terminal-dark appearance.
 * The returned fragment includes the code container and a trailing empty paragraph.
 *
 * Visual design (VS Code-inspired):
 *   - Container: #1e1e1e background, 1px #3c3c3c border, 6px radius
 *   - Header: #252526 background, separated from code area by a 1px #3c3c3c border
 *   - Code area: #1e1e1e background, Consolas/monospace, #d4d4d4 text
 *   - No accent gradient line at the top
 *
 * NOTE: The container has contentEditable="false" so the outer editor cannot
 * accidentally delete the block via Backspace/Delete. Only the delete button
 * (data-delete-handler="1") removes the block.
 *
 * NOTE: The delete button's onclick handler is NOT wired here because it needs
 * access to the `handleContentChange` callback. The caller must call
 * `normalizeCodeBlocks()` after insertion, or wire the handler manually.
 *
 * @param language - Programming language identifier / プログラミング言語識別子
 * @param code - Initial code content (defaults to empty) / 初期コード内容
 * @returns DocumentFragment containing the code block and a trailing `<p>` / DocumentFragment
 */
export function createCodeBlockNode(language: string, code: string = ''): DocumentFragment {
  const frag = document.createDocumentFragment();

  // ── Outer container ────────────────────────────────────────────────────────
  const container = document.createElement('div');
  container.className = 'code-block-container';
  container.dataset.rapitasCodeBlock = '1';
  // NOTE: contentEditable="false" makes this container an atomic island inside
  // the outer editor, preventing keyboard deletion. The nested <code> element
  // re-enables editing for the code content only.
  container.contentEditable = 'false';
  container.style.position = 'relative';
  container.style.marginBottom = '16px';
  container.style.borderRadius = '6px';
  container.style.overflow = 'hidden';
  container.style.backgroundColor = '#1e1e1e';
  container.style.border = '1px solid #3c3c3c';
  container.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
  // Prevent browser from adding a focus ring around the container
  container.style.outline = 'none';

  // ── Collapse toggle + description area ────────────────────────────────────
  const collapseToggle = buildCollapseToggle();
  const descEl = buildDescEl();

  // ── Header ─────────────────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.padding = '8px 14px';
  header.style.backgroundColor = '#252526';
  // Horizontal line separating header from code area
  header.style.borderBottom = '1px solid #3c3c3c';
  header.style.userSelect = 'none';

  // Language badge: coloured dot + name label
  const langColor = getLangColor(language);
  const langBadge = document.createElement('div');
  langBadge.style.display = 'flex';
  langBadge.style.alignItems = 'center';
  langBadge.style.gap = '8px';

  const dot = document.createElement('span');
  dot.style.display = 'inline-block';
  dot.style.width = '9px';
  dot.style.height = '9px';
  dot.style.borderRadius = '50%';
  dot.style.backgroundColor = langColor;
  dot.style.flexShrink = '0';
  dot.style.boxShadow = `0 0 5px ${langColor}99`;

  const langLabel = document.createElement('span');
  langLabel.textContent = programmingLanguages.find((l) => l.value === language)?.label ?? language;
  langLabel.style.fontSize = '12px';
  langLabel.style.fontFamily = "Consolas, Monaco, 'Courier New', monospace";
  langLabel.style.fontWeight = '500';
  langLabel.style.color = '#858585';
  langLabel.style.letterSpacing = '0.04em';

  langBadge.appendChild(dot);
  langBadge.appendChild(langLabel);

  // ── Code element (must exist before buttons reference it) ──────────────────
  const codeElement = document.createElement('code');
  codeElement.className = `language-${language}`;
  codeElement.style.fontFamily = "Consolas, Monaco, 'Courier New', monospace";
  codeElement.style.fontSize = '13.5px';
  codeElement.style.lineHeight = '1.65';
  codeElement.style.color = '#d4d4d4';
  codeElement.style.backgroundColor = 'transparent';
  codeElement.contentEditable = 'true';
  codeElement.style.outline = 'none';
  codeElement.style.boxShadow = 'none';
  codeElement.style.display = 'block';
  codeElement.style.whiteSpace = 'pre';
  // NOTE: Override the global [contenteditable='true'] rule in globals.css which
  // sets -webkit-line-break:after-white-space and word-wrap:break-word.
  // Those properties interfere with white-space:pre newline rendering.
  codeElement.style.lineBreak = 'normal';
  codeElement.style.wordWrap = 'normal';
  codeElement.style.overflowWrap = 'normal';
  codeElement.style.minHeight = '1.65em';
  codeElement.spellcheck = false;

  // Apply initial highlighting (or show placeholder text as highlighted code)
  const initialText = code || '// ここにコードを入力...';
  codeElement.innerHTML = highlightCode(initialText, language);

  attachKeyHandlers(codeElement, language);
  attachHighlightHandlers(codeElement, language);
  attachPasteHandler(codeElement);

  // ── Buttons ────────────────────────────────────────────────────────────────
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '4px';
  buttonContainer.style.alignItems = 'center';
  buttonContainer.appendChild(buildCopyButton(codeElement));
  buttonContainer.appendChild(buildDeleteButton());

  // Left side: [chevron, langBadge]
  const headerLeft = document.createElement('div');
  headerLeft.style.display = 'flex';
  headerLeft.style.alignItems = 'center';
  headerLeft.style.gap = '8px';
  headerLeft.appendChild(collapseToggle);
  headerLeft.appendChild(langBadge);

  header.appendChild(headerLeft);
  header.appendChild(buttonContainer);
  container.appendChild(header);
  container.appendChild(descEl);

  // ── Pre / code area ────────────────────────────────────────────────────────
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.padding = '0';
  pre.style.display = 'flex';
  pre.style.alignItems = 'flex-start';
  pre.style.overflowX = 'auto';
  pre.style.backgroundColor = '#1e1e1e';
  // NOTE: Set white-space explicitly in case Tailwind v4 preflight resets <pre>.
  pre.style.whiteSpace = 'pre';

  // Padding moved from pre to code element (line numbers gutter sits to the left)
  codeElement.style.padding = '14px 18px';
  codeElement.style.flex = '1';
  codeElement.style.minWidth = '0';

  pre.appendChild(codeElement);
  attachLineNumbers(pre, codeElement);
  container.appendChild(pre);
  attachCollapseToggle(container, collapseToggle, pre, descEl);

  // Mark so the caller can attach the delete handler after insertion
  container.dataset.needsDeleteHandler = '1';
  frag.appendChild(container);

  // Trailing empty paragraph keeps the cursor outside the block after insertion
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  frag.appendChild(p);

  return frag;
}

/**
 * Re-attach key handlers, highlight handlers, and delete button listeners to
 * all code blocks in the editor container. Call this after loading saved note
 * HTML so that blocks parsed from stored content regain their interactive
 * behaviour and display syntax highlighting.
 *
 * @param editorEl - The editor's contentEditable root element / エディタのルート要素
 * @param onContentChange - Callback to mark the note dirty / 変更通知コールバック
 */
export function normalizeCodeBlocks(editorEl: HTMLDivElement, onContentChange: () => void): void {
  editorEl.querySelectorAll<HTMLElement>('[data-rapitas-code-block]').forEach((block) => {
    // Ensure the non-editable guard is set even on blocks restored from storage
    block.contentEditable = 'false';

    // Re-wire delete button
    const deleteBtn = block.querySelector<HTMLElement>('[data-delete-handler="1"]');
    if (deleteBtn) {
      deleteBtn.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        block.remove();
        onContentChange();
      };
    }

    // Re-wire collapse toggle (persists collapsed state via data-collapsed attribute)
    const toggleBtn = block.querySelector<HTMLButtonElement>('[data-collapse-toggle="1"]');
    const preEl2 = block.querySelector<HTMLElement>('pre');
    let descEl2 = block.querySelector<HTMLElement>('.code-block-desc');
    if (!descEl2) {
      // Old block without description area — inject one after the header
      descEl2 = buildDescEl();
      const headerEl = block.querySelector<HTMLElement>('div:first-child');
      if (headerEl) headerEl.insertAdjacentElement('afterend', descEl2);
      else block.prepend(descEl2);
    }
    if (toggleBtn && preEl2) {
      attachCollapseToggle(block, toggleBtn, preEl2, descEl2);
    }

    // Re-attach keyboard and highlight handlers using the language class name.
    // Also re-ensure contentEditable="true" on the code element in case
    // DOMPurify stripped the attribute.
    const codeEl = block.querySelector<HTMLElement>('code');
    if (codeEl) {
      codeEl.contentEditable = 'true';
      const lang =
        Array.from(codeEl.classList)
          .find((c) => c.startsWith('language-'))
          ?.replace('language-', '') ?? 'plaintext';
      attachKeyHandlers(codeEl, lang);
      attachHighlightHandlers(codeEl, lang);
      attachPasteHandler(codeEl);

      // Ensure line number gutter exists; re-attach observer after page reload
      const preEl = block.querySelector<HTMLElement>('pre');
      if (preEl) {
        preEl.style.display = 'flex';
        preEl.style.alignItems = 'flex-start';
        preEl.style.padding = '0';
        if (!codeEl.style.padding) codeEl.style.padding = '14px 18px';
        codeEl.style.flex = '1';
        codeEl.style.minWidth = '0';
        attachLineNumbers(preEl, codeEl);
      }

      // Re-apply highlighting to any content already present (e.g. loaded from storage)
      const text = codeEl.textContent ?? '';
      if (text.trim()) {
        codeEl.innerHTML = highlightCode(text, lang);
      }
    }
  });
}
