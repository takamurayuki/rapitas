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
 */

import { programmingLanguages } from './constants';
import { highlightCode } from './code-block-highlight';
import {
  getCurrentLine,
  getIndentation,
  getIndentString,
  shouldAutoIndent,
} from './code-block-indent';

/** Auto-pair characters for bracket/quote completion. */
const AUTO_PAIRS: Record<string, string> = {
  '(': ')',
  '[': ']',
  '{': '}',
  '"': '"',
  "'": "'",
  '`': '`',
};

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
function getLangColor(language: string): string {
  return LANG_COLORS[language] ?? '#4ade80';
}

/**
 * Attach keyboard interaction handlers to the editable code element.
 * Handles Enter (auto-indent), Tab (insert indent), Backspace guard, and auto-pairs.
 *
 * NOTE: The Backspace guard uses a preRange character-offset check so that it
 * works correctly when the element contains highlight `<span>` children — a simple
 * `range.startOffset === 0` check would fail inside nested spans.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 * @param language - Language identifier for indent rules / インデントルール用言語識別子
 */
export function attachKeyHandlers(codeElement: HTMLElement, language: string): void {
  codeElement.onkeydown = (e) => {
    const keyboardEvent = e as KeyboardEvent;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // NOTE: Prevent Backspace from exiting the code block when the caret is at
    // character offset 0 in the element (regardless of span nesting depth).
    if (keyboardEvent.key === 'Backspace') {
      const range = selection.getRangeAt(0);
      if (range.collapsed) {
        const preRange = document.createRange();
        preRange.selectNodeContents(codeElement);
        preRange.setEnd(range.startContainer, range.startOffset);
        if (preRange.toString().length === 0) {
          e.preventDefault();
          return;
        }
      }
    }

    // Enter key — insert newline with auto-indent
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      e.preventDefault();
      const range = selection.getRangeAt(0);
      // Pass codeElement so getCurrentLine works inside highlighted spans
      const currentLine = getCurrentLine(range, codeElement);
      const indent = getIndentation(currentLine);
      const increaseIndent = shouldAutoIndent(currentLine, language);

      const insertStr = '\n' + indent + (increaseIndent ? getIndentString(language) : '');

      // NOTE: execCommand('insertText', '\n') is unreliable in Chromium on
      // white-space:pre contenteditable — the '\n' is sometimes not rendered as
      // a visible line break.  Insert a real Text node via the Range API instead.
      if (!range.collapsed) range.deleteContents();
      const newlineNode = document.createTextNode(insertStr);
      range.insertNode(newlineNode);
      const newRange = document.createRange();
      newRange.setStartAfter(newlineNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    // Tab key — insert language-appropriate indent
    if (keyboardEvent.key === 'Tab') {
      e.preventDefault();
      const range = selection.getRangeAt(0);
      if (!range.collapsed) range.deleteContents();
      const tabNode = document.createTextNode(getIndentString(language));
      range.insertNode(tabNode);
      const newRange = document.createRange();
      newRange.setStartAfter(tabNode);
      newRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(newRange);
    }

    // Auto-close brackets and quotes
    if (AUTO_PAIRS[keyboardEvent.key as string]) {
      e.preventDefault();
      const closing = AUTO_PAIRS[keyboardEvent.key];
      const range = selection.getRangeAt(0);

      if (!range.collapsed) {
        const selectedText = range.toString();
        document.execCommand('insertText', false, keyboardEvent.key + selectedText + closing);
        const newRange = document.createRange();
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          newRange.setStart(textNode, range.startOffset + 1 + selectedText.length);
          newRange.setEnd(textNode, range.startOffset + 1 + selectedText.length);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      } else {
        document.execCommand('insertText', false, keyboardEvent.key + closing);
        const newRange = document.createRange();
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          const offset = range.startOffset + 1;
          newRange.setStart(textNode, offset);
          newRange.setEnd(textNode, offset);
          selection.removeAllRanges();
          selection.addRange(newRange);
        }
      }
    }
  };
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
 * Attach a MutationObserver-driven line number gutter to the pre+code pair.
 * Removes any stale gutter first so re-running `normalizeCodeBlocks` is idempotent.
 * MutationObserver captures ALL content changes (typing, paste, Enter, Tab, delete)
 * without needing per-handler event dispatching.
 *
 * @param preEl - The `<pre>` wrapper (must already be display:flex) / preラッパー要素
 * @param codeElement - The contenteditable code element / コード要素
 */
function attachLineNumbers(preEl: HTMLElement, codeElement: HTMLElement): void {
  // Remove stale gutter (present when re-normalizing or loading from saved HTML)
  preEl.querySelectorAll('.code-line-numbers').forEach((n) => n.remove());

  const gutterEl = buildLineNumbersEl();
  preEl.insertBefore(gutterEl, codeElement);
  refreshLineNumbers(gutterEl, codeElement);

  const observer = new MutationObserver(() => refreshLineNumbers(gutterEl, codeElement));
  observer.observe(codeElement, { childList: true, subtree: true, characterData: true });
}

/**
 * Attach the paste handler that strips HTML formatting from pasted content.
 * Without this, pasting from an IDE (e.g. VS Code) inserts rich-text HTML that
 * carries the source editor's background-color/inline styles, causing white
 * patches to appear inside the dark code block.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 */
function attachPasteHandler(codeElement: HTMLElement): void {
  codeElement.onpaste = (e) => {
    e.preventDefault();
    const plain = e.clipboardData?.getData('text/plain') ?? '';
    if (!plain) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) range.deleteContents();
    const textNode = document.createTextNode(plain);
    range.insertNode(textNode);
    const newRange = document.createRange();
    newRange.setStartAfter(textNode);
    newRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(newRange);
  };
}

/**
 * Attach the blur handler that applies syntax highlighting after the user
 * finishes editing.
 *
 * NOTE: We do NOT convert to plain text on focus.  Doing so requires a
 * programmatic `sel.removeAllRanges / addRange` call which:
 *   (a) Suppresses the cursor-blink animation in Chromium until the next user
 *       interaction, making the caret invisible.
 *   (b) Races with `mouseup` in the click-event sequence (mousedown → focus →
 *       mouseup).  `getCursorOffset` reads position 0 if called before the
 *       browser commits the cursor from mousedown, so `setCursorOffset(el, 0)`
 *       jumps the caret to the start — causing Backspace to delete from there.
 *
 * Without an onfocus conversion the browser places the caret naturally inside
 * whatever span the user clicked on.  All key handlers (Backspace guard, Enter,
 * getCurrentLine) use `preRange.toString().length` which is span-aware and works
 * correctly without touching `innerHTML`.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 * @param language - Language identifier / 言語識別子
 */
function attachHighlightHandlers(codeElement: HTMLElement, language: string): void {
  codeElement.onfocus = null; // explicitly clear in case normalizeCodeBlocks re-runs

  codeElement.onblur = () => {
    const plain = codeElement.textContent ?? '';
    if (plain) {
      codeElement.innerHTML = highlightCode(plain, language);
    }
  };
}

/**
 * Build and return the copy button element.
 *
 * @param codeElement - Code element whose text will be copied / コピー元コード要素
 * @returns Configured copy button / コピーボタン要素
 */
function buildCopyButton(codeElement: HTMLElement): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = 'コピー';
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
      btn.textContent = '✓ コピー済';
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
 * @returns Delete button marked with data-delete-handler="1" / 削除ボタン要素
 */
function buildDeleteButton(): HTMLButtonElement {
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
  btn.title = 'コードブロックを削除';
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

  header.appendChild(langBadge);
  header.appendChild(buttonContainer);
  container.appendChild(header);

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
