'use client';
/**
 * WysiwygNoteSurface
 *
 * The visual editing surface of a Markdown note: a contentEditable area with
 * the note toolbar and the table handles. The surface is uncontrolled — its
 * HTML is set once when it mounts and React never renders into it — and it
 * writes itself back to Markdown (domToMarkdown) a moment after each edit
 * and whenever the caller asks (`flush`, before a save or a mode switch).
 * Not responsible for saving or for the mode switch; see MarkdownNoteEditor.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { domToMarkdown } from '../html-to-markdown';
import { createInlineLink, linkRange, urlFromPastedText } from '../../editor/inline-link';
import { useTableControls } from '../../editor/useTableControls';
import { TableControlsOverlay } from '../../editor/TableControlsOverlay';
import WysiwygToolbar from './WysiwygToolbar';

/** How long after the last keystroke the surface is written back. */
const WRITE_DELAY_MS = 200;

/** What the editor can ask of a mounted surface. */
export interface WysiwygSurfaceHandle {
  /** Write the surface back now and return the Markdown / 今すぐ書き出して返す */
  flush: () => string;
}

interface WysiwygNoteSurfaceProps {
  /** HTML to start from (markdownToEditableHtml) / 初期 HTML */
  initialHtml: string;
  /** The user changed something / 利用者が編集した */
  onEdit: () => void;
  /** The surface written back as Markdown / 書き出した Markdown */
  onMarkdown: (markdown: string) => void;
  /** Filled with the surface's handle while mounted / マウント中のハンドル */
  handleRef: RefObject<WysiwygSurfaceHandle | null>;
}

/** Insert text (or a link for a lone URL) at the caret, replacing the selection. */
function insertPlainText(root: HTMLElement, text: string): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return;
  const url = urlFromPastedText(text);
  if (url && !range.collapsed && linkRange(range, url)) return;
  range.deleteContents();
  const node = url ? createInlineLink(url, url) : document.createTextNode(text);
  range.insertNode(node);
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * The contentEditable surface, its toolbar and its table handles.
 *
 * @param props - Initial HTML, change callbacks and the handle ref / 初期 HTML・変更通知・ハンドル
 */
export default function WysiwygNoteSurface({
  initialHtml,
  onEdit,
  onMarkdown,
  handleRef,
}: WysiwygNoteSurfaceProps) {
  const t = useTranslations('notes.markdownNote');
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // React detaches surfaceRef before the unmount cleanup runs; the element is
  // kept here so a pending write can still be read then.
  const mountedEl = useRef<HTMLDivElement | null>(null);
  const callbacks = useRef({ onEdit, onMarkdown });
  callbacks.current = { onEdit, onMarkdown };

  const flush = useCallback((): string => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const root = surfaceRef.current ?? mountedEl.current;
    const markdown = root ? domToMarkdown(root) : '';
    callbacks.current.onMarkdown(markdown);
    return markdown;
  }, []);

  const edited = useCallback(() => {
    callbacks.current.onEdit();
    if (timer.current) clearTimeout(timer.current);
    // Debounced: a 200,000-character note is not walked on every keystroke.
    timer.current = setTimeout(flush, WRITE_DELAY_MS);
  }, [flush]);

  // Set once on mount; after that the DOM belongs to the user's editing.
  useLayoutEffect(() => {
    mountedEl.current = surfaceRef.current;
    if (surfaceRef.current) surfaceRef.current.innerHTML = initialHtml;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately only the first HTML
  }, []);

  useEffect(() => {
    handleRef.current = { flush };
    return () => {
      // A pending write must not be lost when the surface unmounts.
      if (timer.current) flush();
      handleRef.current = null;
    };
  }, [flush, handleRef]);

  const controls = useTableControls(
    surfaceRef,
    containerRef,
    (n) => t('toolbar.columnHeading', { n }),
    edited,
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <WysiwygToolbar surfaceRef={surfaceRef} onCommand={edited} />
      <div ref={containerRef} className="relative flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        {/* The click handler only notices a ticked checklist box; a box ticked
            with the keyboard (Space) fires the same click, so no key handler. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
        <div
          ref={surfaceRef}
          tabIndex={0}
          role="textbox"
          aria-multiline="true"
          aria-label={t('surfaceLabel')}
          contentEditable
          suppressContentEditableWarning
          spellCheck={false}
          onInput={edited}
          onBlur={() => {
            if (timer.current) flush();
          }}
          onPaste={(e) => {
            // Outside HTML never enters the surface: paste as text.
            e.preventDefault();
            if (surfaceRef.current)
              insertPlainText(surfaceRef.current, e.clipboardData.getData('text/plain'));
            edited();
          }}
          onClick={(e) => {
            const target = e.target as HTMLElement;
            if (target instanceof HTMLInputElement && target.type === 'checkbox') edited();
          }}
          className="min-h-full px-4 py-3 outline-none text-sm leading-normal text-zinc-800 dark:text-zinc-200 [&_h1]:text-[22px] [&_h1]:font-bold [&_h1]:my-3 [&_h2]:text-base [&_h2]:font-bold [&_h2]:my-3 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:my-2 [&_p]:my-2 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li:has(>input)]:list-none [&_li>input]:mr-1.5 [&_blockquote]:border-l-[3px] [&_blockquote]:border-indigo-500 [&_blockquote]:bg-zinc-100 [&_blockquote]:pl-3 [&_blockquote]:py-1 dark:[&_blockquote]:bg-zinc-800/60 [&_pre]:my-3 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:bg-zinc-100 [&_pre]:font-mono [&_pre]:text-xs dark:[&_pre]:bg-zinc-950 [&_table]:my-3 [&_table]:border-collapse [&_td]:border [&_th]:border [&_td]:border-zinc-300 [&_th]:border-zinc-300 dark:[&_td]:border-zinc-600 dark:[&_th]:border-zinc-600 [&_td]:px-2 [&_td]:py-1 [&_th]:px-2 [&_th]:py-1 [&_a]:text-indigo-600 [&_a]:underline dark:[&_a]:text-indigo-400 [&_mark]:text-zinc-900 [&_mark]:rounded-sm [&_mark]:px-0.5"
        />
        <TableControlsOverlay controls={controls} />
      </div>
    </div>
  );
}
