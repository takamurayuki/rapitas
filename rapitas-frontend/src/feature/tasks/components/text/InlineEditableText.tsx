'use client';
/**
 * InlineEditableText
 *
 * Edit text in place: double-click to enter edit mode, blur to save (Enter
 * also saves single-line; Cmd/Ctrl+Enter saves multiline), Escape cancels.
 * Lets the task detail edit title/description without a separate edit screen.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

interface InlineEditableTextProps {
  /** Current value. */
  value: string;
  /** Called with the new value when an edit is committed (changed & valid). */
  onSave: (next: string) => void;
  /** Render a `<textarea>` instead of an `<input>`. */
  multiline?: boolean;
  /** Reject empty values — keeps the previous value instead of saving. */
  required?: boolean;
  /** Shown (muted) in display mode when the value is empty. */
  placeholder?: string;
  /** Accessible label for the editor control. */
  ariaLabel?: string;
  /** Typography classes shared by the display element and the editor. */
  className?: string;
  /** Custom display renderer (e.g. markdown). Defaults to plain text. */
  renderDisplay?: (value: string) => React.ReactNode;
}

/**
 * Double-click-to-edit text field with blur-to-save semantics.
 *
 * @param props - See {@link InlineEditableTextProps} / 各プロパティ
 * @returns The display element, or the editor while editing / 表示要素、編集中はエディタ
 */
export default function InlineEditableText({
  value,
  onSave,
  multiline = false,
  required = false,
  placeholder,
  ariaLabel,
  className = '',
  renderDisplay,
}: InlineEditableTextProps) {
  const t = useTranslations('task');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // Set by cancel() so the resulting blur does not also commit the draft.
  const skipBlurRef = useRef(false);

  useEffect(() => {
    if (editing && inputRef.current) {
      const el = inputRef.current;
      el.focus();
      // Place the caret at the end instead of selecting all, so a double-click
      // continues editing rather than replacing the whole value on first keypress.
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }
  }, [editing]);

  // Auto-resize textarea to match content height on open and on each keystroke.
  useEffect(() => {
    if (!multiline || !editing || !inputRef.current) return;
    const el = inputRef.current;
    // Reset first so shrinking content reduces height correctly.
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, multiline, editing]);

  const begin = () => {
    setDraft(value);
    setEditing(true);
  };

  const commit = () => {
    if (skipBlurRef.current) {
      skipBlurRef.current = false;
      return;
    }
    setEditing(false);
    const next = multiline ? draft : draft.trim();
    if (required && !next.trim()) return; // keep previous value
    if (next === value) return;
    onSave(next);
  };

  const cancel = () => {
    skipBlurRef.current = true;
    setDraft(value);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      e.currentTarget.blur(); // commits via onBlur
    }
  };

  if (editing) {
    const editorCls = `w-full bg-zinc-50 dark:bg-zinc-800/50 rounded px-1.5 py-0.5 outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${className}`;
    if (multiline) {
      return (
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={handleKeyDown}
          aria-label={ariaLabel}
          className={`${editorCls} resize-y overflow-hidden`}
          style={{ minHeight: '5rem' }}
        />
      );
    }
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        aria-label={ariaLabel}
        className={editorCls}
      />
    );
  }

  const isEmpty = !value.trim();
  return (
    <div
      onDoubleClick={begin}
      title={t('inlineEditableText.doubleClickToEdit')}
      className={`cursor-text ${className} ${isEmpty ? 'italic text-zinc-400 dark:text-zinc-500' : ''}`}
    >
      {isEmpty ? (placeholder ?? '') : renderDisplay ? renderDisplay(value) : value}
    </div>
  );
}
