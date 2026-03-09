import { programmingLanguages } from './constants';

/**
 * Syntax-highlight code text for a given language.
 * Returns HTML string with inline color spans.
 */
export function highlightCode(text: string, lang: string): string {
  // エスケープ処理
  let highlighted = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 言語別のキーワード
  const keywords: { [key: string]: string[] } = {
    javascript: [
      'const',
      'let',
      'var',
      'function',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'extends',
      'new',
      'this',
      'super',
      'import',
      'export',
      'default',
      'from',
      'async',
      'await',
      'try',
      'catch',
      'throw',
      'finally',
    ],
    typescript: [
      'const',
      'let',
      'var',
      'function',
      'return',
      'if',
      'else',
      'for',
      'while',
      'class',
      'extends',
      'new',
      'this',
      'super',
      'import',
      'export',
      'default',
      'from',
      'async',
      'await',
      'try',
      'catch',
      'throw',
      'finally',
      'interface',
      'type',
      'enum',
      'implements',
      'private',
      'public',
      'protected',
    ],
    python: [
      'def',
      'class',
      'if',
      'else',
      'elif',
      'for',
      'while',
      'return',
      'import',
      'from',
      'as',
      'try',
      'except',
      'finally',
      'with',
      'lambda',
      'yield',
      'pass',
      'break',
      'continue',
      'True',
      'False',
      'None',
      'and',
      'or',
      'not',
      'in',
      'is',
    ],
    java: [
      'public',
      'private',
      'protected',
      'class',
      'interface',
      'extends',
      'implements',
      'static',
      'final',
      'void',
      'int',
      'String',
      'boolean',
      'if',
      'else',
      'for',
      'while',
      'return',
      'new',
      'this',
      'super',
      'try',
      'catch',
      'finally',
      'throw',
      'throws',
    ],
  };

  const langKeywords = keywords[lang] || [];

  if (langKeywords.length > 0) {
    const keywordRegex = new RegExp(
      `\\b(${langKeywords.join('|')})\\b`,
      'g',
    );
    highlighted = highlighted.replace(
      keywordRegex,
      '<span style="color: #c792ea;">$1</span>',
    );
  }

  // 文字列のハイライト（シングル・ダブル・バッククォート）
  highlighted = highlighted.replace(
    /(["'`])(?:(?=(\\?))\2.)*?\1/g,
    '<span style="color: #c3e88d;">$&</span>',
  );

  // コメントのハイライト
  if (
    [
      'javascript',
      'typescript',
      'java',
      'c',
      'cpp',
      'csharp',
      'go',
      'rust',
      'swift',
      'kotlin',
      'php',
    ].includes(lang)
  ) {
    highlighted = highlighted.replace(
      /(\/\/.*$)/gm,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
    highlighted = highlighted.replace(
      /(\/\*[\s\S]*?\*\/)/g,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  } else if (
    ['python', 'ruby', 'bash', 'powershell', 'yaml'].includes(lang)
  ) {
    highlighted = highlighted.replace(
      /(#.*$)/gm,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  } else if (['html', 'xml'].includes(lang)) {
    highlighted = highlighted.replace(
      /(<!--[\s\S]*?-->)/g,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  } else if (lang === 'css') {
    highlighted = highlighted.replace(
      /(\/\*[\s\S]*?\*\/)/g,
      '<span style="color: #546e7a; font-style: italic;">$1</span>',
    );
  }

  // 数値のハイライト
  highlighted = highlighted.replace(
    /\b(\d+(?:\.\d+)?)\b/g,
    '<span style="color: #f78c6c;">$1</span>',
  );

  return highlighted;
}

/** Get the current line text before the cursor position */
function getCurrentLine(range: Range): string {
  const container = range.startContainer;
  const text = container.textContent || '';
  const beforeCursor = text.substring(0, range.startOffset);
  const lines = beforeCursor.split('\n');
  return lines[lines.length - 1];
}

/** Extract leading whitespace from a line */
function getIndentation(line: string): string {
  const match = line.match(/^(\s*)/);
  return match ? match[1] : '';
}

/** Return the indent string appropriate for the language */
function getIndentString(lang: string): string {
  if (lang === 'python') return '    ';
  if (lang === 'go' || lang === 'rust') return '\t';
  return '  ';
}

/** Decide whether to auto-indent after the given line */
function shouldAutoIndent(line: string, lang: string): boolean {
  const trimmed = line.trim();

  if (
    [
      'javascript',
      'typescript',
      'java',
      'csharp',
      'cpp',
      'c',
      'rust',
      'go',
      'php',
      'swift',
      'kotlin',
    ].includes(lang)
  ) {
    if (trimmed.endsWith('{')) return true;
  }

  if (['python', 'ruby'].includes(lang)) {
    if (trimmed.endsWith(':')) return true;
  }

  if (['html', 'xml'].includes(lang)) {
    if (
      /<[^>]+>$/.test(trimmed) &&
      !/<\/[^>]+>$/.test(trimmed) &&
      !/>\/\s*$/.test(trimmed)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Build a complete code-block DOM fragment.
 * The returned fragment includes the code container and a trailing empty paragraph.
 *
 * NOTE: The delete button's onclick handler is NOT wired here because it needs
 * access to the `handleContentChange` callback that lives in the component.
 * The caller must query `[data-needs-delete-handler="1"]` after insertion and
 * attach the handler manually.
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

  // ヘッダー部分（言語名とコピーボタン）
  const header = document.createElement('div');
  header.style.display = 'flex';
  header.style.justifyContent = 'space-between';
  header.style.alignItems = 'center';
  header.style.padding = '8px 12px';
  header.style.backgroundColor = '#0f172a';
  header.style.borderBottom = '1px solid #334155';

  // 言語ラベル
  const langLabel = document.createElement('span');
  langLabel.textContent =
    programmingLanguages.find((l) => l.value === language)?.label || language;
  langLabel.style.fontSize = '12px';
  langLabel.style.color = '#94a3b8';
  langLabel.style.fontFamily = 'monospace';
  header.appendChild(langLabel);

  // ボタンコンテナ
  const buttonContainer = document.createElement('div');
  buttonContainer.style.display = 'flex';
  buttonContainer.style.gap = '8px';

  // コピーボタン
  const copyButton = document.createElement('button');
  copyButton.textContent = 'コピー';
  copyButton.style.padding = '4px 12px';
  copyButton.style.fontSize = '12px';
  copyButton.style.backgroundColor = '#334155';
  copyButton.style.color = '#e2e8f0';
  copyButton.style.border = 'none';
  copyButton.style.borderRadius = '4px';
  copyButton.style.cursor = 'pointer';
  copyButton.style.transition = 'all 0.2s';
  copyButton.onmouseover = () => {
    copyButton.style.backgroundColor = '#475569';
  };
  copyButton.onmouseout = () => {
    copyButton.style.backgroundColor = '#334155';
  };

  // 削除ボタン
  const deleteButton = document.createElement('button');
  // SVGアイコンを安全に作成
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
  path1.setAttribute('d', 'M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z');

  const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path2.setAttribute('d', 'M10 11v6M14 11v6');

  svg.appendChild(path1);
  svg.appendChild(path2);
  deleteButton.appendChild(svg);
  deleteButton.style.padding = '4px 8px';
  deleteButton.style.fontSize = '12px';
  deleteButton.style.backgroundColor = '#ef4444';
  deleteButton.style.color = '#ffffff';
  deleteButton.style.border = 'none';
  deleteButton.style.borderRadius = '4px';
  deleteButton.style.cursor = 'pointer';
  deleteButton.style.transition = 'all 0.2s';
  deleteButton.style.display = 'flex';
  deleteButton.style.alignItems = 'center';
  deleteButton.title = '削除';
  deleteButton.dataset.deleteHandler = '1';
  deleteButton.onmouseover = () => {
    deleteButton.style.backgroundColor = '#dc2626';
  };
  deleteButton.onmouseout = () => {
    deleteButton.style.backgroundColor = '#ef4444';
  };

  buttonContainer.appendChild(copyButton);
  buttonContainer.appendChild(deleteButton);
  header.appendChild(buttonContainer);
  container.appendChild(header);

  // コード部分
  const pre = document.createElement('pre');
  pre.style.margin = '0';
  pre.style.padding = '16px';
  pre.style.overflowX = 'auto';
  pre.style.backgroundColor = '#1e293b';

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

  // コードブロック内でのキーバインドと補完
  codeElement.onkeydown = (e) => {
    const keyboardEvent = e as KeyboardEvent;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Backspace/Deleteキーでの削除を制御
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

    // Enter キー
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

    // Tab キー（インデント）
    if (keyboardEvent.key === 'Tab') {
      e.preventDefault();
      const indentString = getIndentString(language);
      document.execCommand('insertText', false, indentString);
    }

    // 括弧の自動補完
    const autoPairs: { [key: string]: string } = {
      '(': ')',
      '[': ']',
      '{': '}',
      '"': '"',
      "'": "'",
      '`': '`',
    };

    if (autoPairs[keyboardEvent.key]) {
      e.preventDefault();
      const closing = autoPairs[keyboardEvent.key];
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
        document.execCommand(
          'insertText',
          false,
          keyboardEvent.key + closing,
        );

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

  // コピーボタンのクリックイベント
  copyButton.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const codeText = codeElement.textContent || '';
    navigator.clipboard.writeText(codeText).then(() => {
      const originalText = copyButton.textContent;
      copyButton.textContent = 'コピーしました！';
      copyButton.style.backgroundColor = '#22c55e';
      setTimeout(() => {
        copyButton.textContent = originalText;
        copyButton.style.backgroundColor = '#334155';
      }, 2000);
    });
  };

  pre.appendChild(codeElement);
  container.appendChild(pre);

  // コンテナに削除ハンドラフラグを設定
  container.dataset.needsDeleteHandler = '1';

  frag.appendChild(container);

  // コードブロック後の空行
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  frag.appendChild(p);

  return frag;
}
