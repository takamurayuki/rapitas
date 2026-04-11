/**
 * code-block-dom
 *
 * DOM construction for the note editor's code blocks.
 * Responsible for building the complete code-block DocumentFragment including
 * the header, copy button, delete button placeholder, and editable code area.
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

/**
 * Attach keyboard interaction handlers to the editable code element.
 * Handles Enter (auto-indent), Tab (insert indent), Backspace guard, and auto-pairs.
 *
 * @param codeElement - The contenteditable code element / 編集可能なコード要素
 * @param language - Language identifier for indent rules / インデントルール用言語識別子
 */
function attachKeyHandlers(codeElement: HTMLElement, language: string): void {
  codeElement.onkeydown = (e) => {
    const keyboardEvent = e as KeyboardEvent;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Prevent Backspace/Delete from escaping the code block when cursor is at start
    if (keyboardEvent.key === 'Backspace' || keyboardEvent.key === 'Delete') {
      const range = selection.getRangeAt(0);
      if (range.startOffset === 0 && range.collapsed) {
        const rangeContainer = range.startContainer;
        if (
          rangeContainer === codeElement ||
          (rangeContainer.parentNode === codeElement &&
            rangeContainer.previousSibling === null)
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
        document.execCommand(
          'insertText',
          false,
          keyboardEvent.key + selectedText + closing,
        );
        const newRange = document.createRange();
        const textNode = range.startContainer;
        if (textNode.nodeType === Node.TEXT_NODE) {
          newRange.setStart(
            textNode,
            range.startOffset + 1 + selectedText.length,
          );
          newRange.setEnd(
            textNode,
            range.startOffset + 1 + selectedText.length,
          );
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
  btn.style.padding = '4px 12px';
  btn.style.fontSize = '12px';
  btn.style.backgroundColor = '#334155';
  btn.style.color = '#e2e8f0';
  btn.style.border = 'none';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'all 0.2s';
  btn.onmouseover = () => {
    btn.style.backgroundColor = '#475569';
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = '#334155';
  };
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const codeText = codeElement.textContent ?? '';
    navigator.clipboard.writeText(codeText).then(() => {
      const originalText = btn.textContent;
      btn.textContent = 'コピーしました！';
      btn.style.backgroundColor = '#22c55e';
      setTimeout(() => {
        btn.textContent = originalText;
        btn.style.backgroundColor = '#334155';
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
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
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

  btn.style.padding = '4px 8px';
  btn.style.fontSize = '12px';
  btn.style.backgroundColor = '#ef4444';
  btn.style.color = '#ffffff';
  btn.style.border = 'none';
  btn.style.borderRadius = '4px';
  btn.style.cursor = 'pointer';
  btn.style.transition = 'all 0.2s';
  btn.style.display = 'flex';
  btn.style.alignItems = 'center';
  btn.title = '削除';
  btn.dataset.deleteHandler = '1';
  btn.onmouseover = () => {
    btn.style.backgroundColor = '#dc2626';
  };
  btn.onmouseout = () => {
    btn.style.backgroundColor = '#ef4444';
  };

  return btn;
}

/**
 * Build a complete code-block DOM fragment.
 * The returned fragment includes the code container and a trailing empty paragraph.
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
export function createCodeBlockNode(
  language: string,
  code: string = '',
): DocumentFragment {
  const frag = document.createDocumentFragment();

  const container = document.createElement('div');
  container.className = 'code-block-container';
  container.dataset.rapitasCodeBlock = '1';
  container.style.position = 'relative';
  container.style.marginBottom = '16px';
  container.style.borderRadius = '8px';
  container.style.overflow = 'hidden';
  container.style.backgroundColor = '#1e293b';
  container.style.border = '1px solid #334155';

  // Header section
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.padding = '8px 12px';
  header.style.backgroundColor = '#0f172a';
  header.style.borderBottom = '1px solid #334155';

  const langLabel = document.createElement('span');
  langLabel.textContent =
    programmingLanguages.find((l) => l.value === language)?.label ?? language;
  langLabel.style.fontSize = '12px';
  langLabel.style.color = '#94a3b8';
  langLabel.style.fontFamily = 'monospace';
  header.appendChild(langLabel);

  // Code element must exist before building buttons that reference it
  const codeElement = document.createElement('code');
  codeElement.className = `language-${language}`;
  codeElement.textContent = code || '// ここにコードを入力...';
  codeElement.style.fontFamily =
    "'Consolas', 'Monaco', 'Courier New', monospace";
  codeElement.style.fontSize = '14px';
  codeElement.style.lineHeight = '1.5';
  codeElement.style.color = '#e2e8f0';
  codeElement.contentEditable = 'true';
  codeElement.style.outline = 'none';
  codeElement.style.display = 'block';
  codeElement.style.whiteSpace = 'pre';
  codeElement.spellcheck = false;
  attachKeyHandlers(codeElement, language);

  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';
  buttonContainer.appendChild(buildCopyButton(codeElement));
  buttonContainer.appendChild(buildDeleteButton());
  header.appendChild(buttonContainer);
  container.appendChild(header);

  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.padding = '16px';
  pre.style.overflowX = 'auto';
  pre.style.backgroundColor = '#1e293b';
  pre.appendChild(codeElement);
  container.appendChild(pre);

  // Mark container so the caller can attach the delete handler after insertion
  container.dataset.needsDeleteHandler = '1';
  frag.appendChild(container);

  // Trailing empty paragraph keeps the cursor outside the code block
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  frag.appendChild(p);

  return frag;
}
