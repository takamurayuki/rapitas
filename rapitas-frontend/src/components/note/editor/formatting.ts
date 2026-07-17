import { fonts } from './constants';

/**
 * Ensure the content editor owns focus without losing the given selection range.
 *
 * NOTE: Toolbar buttons can steal focus (keyboard activation always does, and
 * mouse clicks did before the pickers suppressed mousedown). If the editor is
 * left unfocused after applying a style, the user's next keystroke goes nowhere
 * and the click needed to refocus re-places the caret OUTSIDE the zero-width
 * anchor span — silently dropping the style. Refocusing here keeps the caret
 * inside the anchor so typing continues styled.
 *
 * @param contentEl - The contentEditable editor element / エディタ要素
 * @param range - Selection range to restore after focusing / フォーカス後に復元する選択範囲
 */
function focusEditorPreservingRange(contentEl: HTMLDivElement, range: Range): void {
  if (contentEl.contains(document.activeElement)) return;
  contentEl.focus();
  // focus() may reset the selection — re-apply the captured range explicitly.
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

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
 * When there is no text selected (collapsed cursor), inserts a zero-width-space
 * anchor span so that the next typed character lands inside it and inherits the
 * size — the same technique used by color-persistence.ts for text colour.
 * @returns true if successfully applied
 */
export function applyFontSize(contentEl: HTMLDivElement | null, size: string): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;
  focusEditorPreservingRange(contentEl, range);

  const span = document.createElement('span');
  span.style.fontSize = size;

  if (range.collapsed) {
    // NOTE: Inserting ​ anchors the cursor inside the span. handleEditorInput
    // strips it once a real character is typed, matching the color-persistence pattern.
    span.textContent = '​';
    range.insertNode(span);
    const newRange = document.createRange();
    newRange.setStart(span.firstChild!, 1);
    newRange.setEnd(span.firstChild!, 1);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return true;
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
 * Wrap the current selection in a font-family span.
 * Handles collapsed cursor via the same zero-width-space anchor pattern as
 * applyFontSize — see that function's comment for the rationale.
 * @returns true if successfully applied
 */
export function applyFont(contentEl: HTMLDivElement | null, font: string): boolean {
  if (isInTitleInput()) return false;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  if (!contentEl?.contains(range.commonAncestorContainer)) return false;
  focusEditorPreservingRange(contentEl, range);

  const span = document.createElement('span');
  span.style.fontFamily = font;

  if (range.collapsed) {
    span.textContent = '​';
    range.insertNode(span);
    const newRange = document.createRange();
    newRange.setStart(span.firstChild!, 1);
    newRange.setEnd(span.firstChild!, 1);
    selection.removeAllRanges();
    selection.addRange(newRange);
    return true;
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

/** Result of detecting the format at the current cursor position */
export interface DetectedFormat {
  fontSize: string;
  fontFamily: string;
  textColor: string;
}

/** Normalizes a CSS font-family list to its first family for comparison. */
function firstFamily(value: string): string {
  return value.split(',')[0].replace(/['"]/g, '').trim().toLowerCase();
}

/**
 * Walks up from a node to `root` looking for an explicit inline font-family.
 *
 * NOTE: Computed style cannot be used here — default note text falls back to
 * the body font (Arial per globals.css), so the picker would misreport
 * unstyled text as "Arial" instead of "default".
 */
function findInlineFontFamily(start: Node, root: HTMLElement | null): string | null {
  let node: Node | null = start;
  while (node && node !== root && node !== document.body) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const inline = (node as HTMLElement).style.fontFamily;
      if (inline) return inline;
    }
    node = node.parentNode;
  }
  return null;
}

/**
 * Detect font size, font family, and text color at the current selection.
 *
 * @param root - Editor root bounding the inline-style walk (usually the contentEditable div) / インライン走査の境界要素
 * @returns Detected format, or null when there is no selection / 選択が無い場合はnull
 */
export function detectCurrentFormat(root?: HTMLElement | null): DetectedFormat | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const range = selection.getRangeAt(0);
  let node = range.commonAncestorContainer;
  if (node.parentNode && node.nodeType === Node.TEXT_NODE) {
    node = node.parentNode;
  }

  const computedStyle = window.getComputedStyle(node as Element);
  const parsedSize = parseInt(computedStyle.fontSize);
  const fontSize = Number.isNaN(parsedSize) ? 16 : parsedSize;

  const inlineFont = findInlineFontFamily(range.commonAncestorContainer, root ?? null);
  const matchingFont = inlineFont
    ? fonts.find((f) => f.value !== 'inherit' && firstFamily(f.value) === firstFamily(inlineFont))
    : undefined;

  const color = computedStyle.color;
  const rgb = color.match(/\d+/g);
  let textColor = '#000000';
  if (rgb) {
    textColor =
      '#' +
      rgb
        // NOTE: rgba() yields extra alpha digits — only the first 3 channels form the hex.
        .slice(0, 3)
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
