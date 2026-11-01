/**
 * shortcut-editable-guard.test
 *
 * The global shortcut handler must not fire while the caret is in editable
 * content. It skipped input / textarea / select but not contentEditable, so
 * every ctrl-letter binding fired while typing in a note and
 * `preventDefault()` ate the native editing command.
 *
 * That was invisible until Ctrl+B was bound (#1074) — Ctrl+B is bold in a
 * contentEditable, so the collision is immediate and obvious. `toggleAI` on
 * Ctrl+E had the same problem already, just without a native command to
 * visibly break.
 *
 * The exported predicate is asserted rather than the component, so the rule
 * is pinned where it is cheap to keep.
 */
import { describe, it, expect } from 'vitest';
import { isEditableTarget } from '../KeyboardShortcuts';

/** jsdom does not reflect the contentEditable property, so set the attribute. */
function contentEditableDiv(): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('contenteditable', 'true');
  document.body.appendChild(el);
  return el;
}

describe('the global shortcut guard', () => {
  it('skips a contentEditable element — this is what protects bold', () => {
    expect(isEditableTarget(contentEditableDiv())).toBe(true);
  });

  it('skips an element nested inside contentEditable', () => {
    const host = contentEditableDiv();
    const inner = document.createElement('span');
    host.appendChild(inner);
    // isContentEditable is inherited, which is why the property is used
    // rather than a check for the attribute.
    expect(isEditableTarget(inner)).toBe(true);
  });

  it('still skips the form fields it always did', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
  });

  it('does not skip ordinary elements, or shortcuts would never fire', () => {
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('does not skip an explicitly non-editable element', () => {
    const el = document.createElement('div');
    el.setAttribute('contenteditable', 'false');
    document.body.appendChild(el);
    expect(isEditableTarget(el)).toBe(false);
  });
});
