/**
 * code-block-dom
 *
 * DOM construction for the note editor's code blocks.
 * Responsible for building the complete code-block DocumentFragment including
 * the accent line, header, copy/delete buttons, and editable code area.
 * Not responsible for syntax highlighting or indentation logic.
 */

import { programmingLanguages } from './constants';
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

/** Language-specific accent colors for the header gradient line. */
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
 * Returns the accent color for a given language.
 *
 * @param language - Language identifier / 言語識別子
 * @returns CSS color string / CSSカラー文字列
 */
function getLangAccentColor(language: string): string {
  return LANG_COLORS[language] ?? '#4ade80';
}

/**
 * Attach keyboard interaction handlers to the editable code element.
 * Handles Enter (auto-indent), Tab (insert indent), Backspace guard, and auto-pairs.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 * @param language - Language identifier for indent rules / インデントルール用言語識別子
 */
export function attachKeyHandlers(codeElement: HTMLElement, language: string): void {
  codeElement.onkeydown = (e) => {
    const keyboardEvent = e as KeyboardEvent;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // NOTE: Prevent Backspace/Delete from moving the cursor out of the code block
    // when at the very first character position. The outer editor keydown guard
    // also blocks keyboard deletion of the container itself.
    if (keyboardEvent.key === 'Backspace' || keyboardEvent.key === 'Delete') {
      const range = selection.getRangeAt(0);
      if (range.startOffset === 0 && range.collapsed) {
        const rangeContainer = range.startContainer;
        if (
          rangeContainer === codeElement ||
          (rangeContainer.parentNode === codeElement && rangeContainer.previousSibling === null)
        ) {
          e.preventDefault();
          return;
        }
      }
    }

    // Enter key — insert newline with auto-indent
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      e.preventDefault();
      const range = selection.getRangeAt(0);
      const currentLine = getCurrentLine(range);
      const indent = getIndentation(currentLine);
      const increaseIndent = shouldAutoIndent(currentLine, language);

      let newLineText = '\n' + indent;
      if (increaseIndent) {
        newLineText += getIndentString(language);
      }
      document.execCommand('insertText', false, newLineText);
    }

    // Tab key — insert language-appropriate indent
    if (keyboardEvent.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertText', false, getIndentString(language));
    }

    // Auto-close brackets and quotes
    if (AUTO_PAIRS[keyboardEvent.key]) {
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
  btn.style.backgroundColor = '#334155';
  btn.style.color = '#94a3b8';
  btn.style.border = '1px solid #475569';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'all 0.15s';
  btn.style.lineHeight = '1.4';
  btn.onmouseover = () => {
    btn.style.backgroundColor = '#475569';
    btn.style.color = '#e2e8f0';
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = '#334155';
    btn.style.color = '#94a3b8';
  };
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const codeText = codeElement.textContent ?? '';
    navigator.clipboard.writeText(codeText).then(() => {
      const originalText = btn.textContent;
      btn.textContent = '✓ コピー済';
      btn.style.backgroundColor = '#166534';
      btn.style.color = '#86efac';
      btn.style.borderColor = '#166534';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = '#334155';
        btn.style.color = '#94a3b8';
        btn.style.borderColor = '#475569';
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
  btn.style.color = '#64748b';
  btn.style.border = '1px solid transparent';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'all 0.15s';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.title = 'コードブロックを削除';
  btn.dataset.deleteHandler = '1';
  btn.onmouseover = () => {
    btn.style.backgroundColor = '#450a0a';
    btn.style.color = '#f87171';
    btn.style.borderColor = '#7f1d1d';
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = 'transparent';
    btn.style.color = '#64748b';
    btn.style.borderColor = 'transparent';
  };

  return btn;
}

/**
 * Build a complete code-block DOM fragment with Qiita-inspired styling.
 * The returned fragment includes the code container and a trailing empty paragraph.
 *
 * NOTE: The container has contentEditable="false" so the outer editor cannot
 * accidentally delete the block via Backspace/Delete. Only the delete button
 * (data-delete-handler="1") is wired to remove the block.
 *
 * NOTE: The delete button's onclick handler is NOT wired here because it needs
 * access to the `handleContentChange` callback that lives in the component.
 * The caller must query `[data-needs-delete-handler="1"]` after insertion and
 * attach the handler manually.
 *
 * @param language - Programming language identifier / プログラミング言語識別子
 * @param code - Initial code content (defaults to placeholder) / 初期コード内容
 * @returns DocumentFragment containing the code block and a trailing `<p>` / コードブロックのDocumentFragment
 */
export function createCodeBlockNode(language: string, code: string = ''): DocumentFragment {
  const frag = document.createDocumentFragment();

  const container = document.createElement('div');
  container.className = 'code-block-container';
  container.dataset.rapitasCodeBlock = '1';
  // NOTE: contentEditable="false" makes this container an atomic island inside the
  // outer editor, preventing keyboard deletion. The nested <code> element re-enables
  // editing for the code content only.
  container.contentEditable = 'false';
  container.style.position = 'relative';
  container.style.marginBottom = '16px';
  container.style.borderRadius = '8px';
  container.style.overflow = 'hidden';
  container.style.backgroundColor = '#1e293b';
  container.style.border = '1px solid #2d3f55';
  container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.25)';

  // Gradient accent line at the top — language-specific color
  const accentColor = getLangAccentColor(language);
  const accent = document.createElement('div');
  accent.style.height = '3px';
  accent.style.background = `linear-gradient(90deg, ${accentColor} 0%, #60a5fa 100%)`;
  container.appendChild(accent);

  // Header section
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.padding = '7px 14px';
  header.style.backgroundColor = '#0f172a';
  header.style.borderBottom = '1px solid #1e293b';

  // Language badge: colored dot + name
  const langBadge = document.createElement('div');
  langBadge.style.display = 'flex';
  langBadge.style.alignItems = 'center';
  langBadge.style.gap = '7px';

  const dot = document.createElement('span');
  dot.style.display = 'inline-block';
  dot.style.width = '8px';
  dot.style.height = '8px';
  dot.style.borderRadius = '50%';
  dot.style.backgroundColor = accentColor;
  dot.style.flexShrink = '0';
  dot.style.boxShadow = `0 0 4px ${accentColor}88`;

  const langLabel = document.createElement('span');
  langLabel.textContent = programmingLanguages.find((l) => l.value === language)?.label ?? language;
  langLabel.style.fontSize = '12px';
  langLabel.style.fontFamily = "Consolas, Monaco, 'Courier New', monospace";
  langLabel.style.fontWeight = '500';
  langLabel.style.color = '#94a3b8';
  langLabel.style.letterSpacing = '0.02em';

  langBadge.appendChild(dot);
  langBadge.appendChild(langLabel);

  // Code element must exist before building buttons that reference it
  const codeElement = document.createElement('code');
  codeElement.className = `language-${language}`;
  codeElement.textContent = code || '// ここにコードを入力...';
  codeElement.style.fontFamily = "'Consolas', 'Monaco', 'Courier New', monospace";
  codeElement.style.fontSize = '14px';
  codeElement.style.lineHeight = '1.6';
  codeElement.style.color = '#e2e8f0';
  // NOTE: Explicit background prevents Tailwind/browser light-mode defaults from
  // overriding the dark code block with a white background inside contentEditable.
  codeElement.style.backgroundColor = 'transparent';
  codeElement.contentEditable = 'true';
  codeElement.style.outline = 'none';
  codeElement.style.display = 'block';
  codeElement.style.whiteSpace = 'pre';
  codeElement.spellcheck = false;
  attachKeyHandlers(codeElement, language);

  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '4px';
  buttonContainer.style.alignItems = 'center';
  buttonContainer.appendChild(buildCopyButton(codeElement));
  buttonContainer.appendChild(buildDeleteButton());

  header.appendChild(langBadge);
  header.appendChild(buttonContainer);
  container.appendChild(header);

  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.padding = '16px 20px';
  pre.style.overflowX = 'auto';
  pre.style.backgroundColor = '#1e293b';
  pre.appendChild(codeElement);
  container.appendChild(pre);

  // Mark container so the caller can attach the delete handler after insertion
  container.dataset.needsDeleteHandler = '1';
  frag.appendChild(container);

  // Trailing empty paragraph keeps the cursor outside the code block after insertion
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  frag.appendChild(p);

  return frag;
}

/**
 * Re-attach key handlers and delete button listeners to all code blocks in the
 * editor container. Call this after loading saved note HTML so that blocks
 * parsed from stored content regain their interactive behaviour.
 *
 * @param editorEl - The editor's contentEditable root element / エディタのルート要素
 * @param onContentChange - Callback to mark the note dirty / 変更通知コールバック
 */
export function normalizeCodeBlocks(editorEl: HTMLDivElement, onContentChange: () => void): void {
  editorEl.querySelectorAll<HTMLElement>('[data-rapitas-code-block]').forEach((block) => {
    // Ensure the non-editable guard is set even on blocks restored from storage.
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

    // Re-attach keyboard handlers using the language from the code element's class
    const codeEl = block.querySelector<HTMLElement>('code[contenteditable]');
    if (codeEl) {
      const lang =
        Array.from(codeEl.classList)
          .find((c) => c.startsWith('language-'))
          ?.replace('language-', '') ?? 'plaintext';
      attachKeyHandlers(codeEl, lang);
    }
  });
}
