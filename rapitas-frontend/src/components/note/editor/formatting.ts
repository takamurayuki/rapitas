import { fonts } from './constants';

/**
 * Check whether the active element is the title input; if so, the caller
 * should skip formatting operations.
 */
export function isInTitleInput(): boolean {
  const activeElement = document.activeElement;
  return !!(
    activeElement &&
    activeElement.tagName === 'INPUT' &&
    (activeElement as HTMLInputElement).type === 'text'
  );
}

/**
 * Apply a document.execCommand formatting command.
 * Ensures the content editor is focused first.
 */
export function applyFormat(
  contentEl: HTMLDivElement | null,
  command: string,
  value?: string,
): void {
  if (isInTitleInput()) return;

  const activeElement = document.activeElement;
  if (!contentEl?.contains(activeElement)) {
    contentEl?.focus();
  }

  document.execCommand(command, false, value);
}

/**
 * Wrap the current selection in a highlight span.
 * @returns true if successfully applied
 */
export function applyHighlight(
  contentEl: HTMLDivElement | null,
  color: string,
  highlightStyleTop: number,
): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;

  const span = document.createElement('span');

  if (highlightStyleTop === 0) {
    span.style.backgroundColor = color;
    span.style.padding = '0 2px';
    span.style.borderRadius = '2px';
  } else {
    span.style.background = `linear-gradient(transparent ${highlightStyleTop}%, ${color} ${highlightStyleTop}%)`;
    span.style.padding = '0 1px';
  }

  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  return true;
}

/**
 * Wrap the current selection in a left-border span.
 * @returns true if successfully applied
 */
export function applyBorderLine(contentEl: HTMLDivElement | null, color: string): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;

  const span = document.createElement('span');
  span.style.borderLeft = `3px solid ${color}`;
  span.style.paddingLeft = '8px';

  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  return true;
}

/**
 * Wrap the current selection in a font-size span.
 * @returns true if successfully applied
 */
export function applyFontSize(contentEl: HTMLDivElement | null, size: string): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;

  const span = document.createElement('span');
  span.style.fontSize = size;

  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  return true;
}

/**
 * Wrap the current selection in a font-family span.
 * @returns true if successfully applied
 */
export function applyFont(contentEl: HTMLDivElement | null, font: string): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;

  const span = document.createElement('span');
  span.style.fontFamily = font;

  try {
    range.surroundContents(span);
  } catch {
    const contents = range.extractContents();
    span.appendChild(contents);
    range.insertNode(span);
  }
  return true;
}

/** Result of detecting the format at the current cursor position */
export interface DetectedFormat {
  fontSize: string;
  fontFamily: string;
  textColor: string;
}

/**
 * Detect font size, font family, and text color at the current selection.
 */
export function detectCurrentFormat(): DetectedFormat | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.parentNode && node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  const computedStyle = window.getComputedStyle(node as Element);
  const fontSize = parseInt(computedStyle.fontSize);

  const fontFamily = computedStyle.fontFamily;
  const matchingFont = fonts.find((f) => {
    if (f.value === 'inherit') return false;
    return fontFamily.includes(f.value.split(',')[0].replace(/['"]/g, ''));
  });

  const color = computedStyle.color;
  const rgb = color.match(/\d+/g);
  let textColor = '#000000';
  if (rgb) {
    textColor =
      '#' +
      rgb
        .map((x) => {
          const hex = parseInt(x).toString(16);
          return hex.length === 1 ? '0' + hex : hex;
        })
        .join('')
        .toUpperCase();
  }

  return {
    fontSize: fontSize.toString(),
    fontFamily: matchingFont ? matchingFont.value : 'inherit',
    textColor,
  };
}
