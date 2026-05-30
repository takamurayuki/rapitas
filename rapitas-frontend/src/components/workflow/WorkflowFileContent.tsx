'use client';
// WorkflowFileContent

import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Loader2, List, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { WorkflowTab } from './workflow-viewer-utils';

/** A heading extracted from markdown for the in-file table of contents. */
interface TocHeading {
  id: string;
  level: number;
  text: string;
}

/**
 * Builds a stable element id from heading text. Matched on BOTH sides (TOC link
 * + rendered <h2>) so links resolve by content, not document position — setext
 * or blockquote headings can no longer desync the numbering.
 *
 * @param text - Plain heading text / 見出しの素テキスト
 * @returns URL-safe slug (CJK preserved) / CJKを保持したスラッグ
 */
function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/\s+/g, '-')
      // Keep letters (incl. CJK via \p{L}) and numbers; drop punctuation.
      .replace(/[^\p{L}\p{N}-]+/gu, '')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'section'
  );
}

/**
 * Builds the element id for a heading purely from its text. Deliberately has no
 * occurrence counter: a shared counter double-increments under React StrictMode's
 * double render, desyncing the rendered <h2> ids from the once-computed TOC ids.
 * Duplicate-named headings therefore share an id; links resolve to the first.
 *
 * @param text - Plain heading text / 見出しの素テキスト
 * @returns Element id / 要素id
 */
function headingId(text: string): string {
  return `wf-h-${slugifyHeading(text)}`;
}

/** Flattens a ReactMarkdown heading's children into plain text. / 子要素を素テキスト化。 */
function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (isValidElement(node)) {
    return nodeToText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

/**
 * Extracts only H2 headings — the "section" titles rendered with the vertical
 * indigo bar — in document order (skipping fenced code). Ids are derived from
 * heading text (slug), so they match the rendered <h2> regardless of position.
 * Finer-grained headings (H1/H3+) are intentionally excluded. / h2見出しのみ抽出。
 *
 * @param md - Raw markdown source / Markdown原文
 * @returns Ordered H2 headings with stable ids / 安定idつきのh2見出し一覧
 */
function extractHeadings(md: string): TocHeading[] {
  const out: TocHeading[] = [];
  const seen = new Set<string>();
  let inFence = false;
  for (const raw of md.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = raw.match(/^(##)\s+(.+?)\s*#*\s*$/);
    if (!m) continue;
    const text = m[2]
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();
    const id = headingId(text);
    // Drop later duplicates so the TOC has one entry per id (links hit the first).
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, level: m[1].length, text });
  }
  return out;
}

interface WorkflowFile {
  exists: boolean;
  content?: string | null;
  lastModified?: string | null;
  size?: number | null;
}

interface WorkflowFileContentProps {
  isLoading: boolean;
  activeFile: WorkflowFile | null;
  activeTabConfig: WorkflowTab;
  /** Whether to show the inline plan-approval CTA (plan tab + plan_created status) */
  showApprovalButton: boolean;
  /** Whether to show the inline verification-complete CTA */
  showCompleteButton: boolean;
  onPlanApprovalRequest?: () => void;
  onCompleteRequest?: () => void;
}

/**
 * Renders the main content area for the active workflow tab.
 *
 * @param isLoading - True while initial file data is being fetched
 * @param activeFile - File metadata and content for the selected tab
 * @param activeTabConfig - Tab definition used for the empty-state icon/message
 * @param showApprovalButton - Show the plan-approval CTA inside the content area
 * @param showCompleteButton - Show the task-complete CTA inside the content area
 * @param isRefetching - True while a manual refresh is running
 * @param onRefetch - Manual refresh trigger / 手動再読み込みトリガ
 * @param onPlanApprovalRequest - Opens the plan-approval modal / 計画承認モーダルを開く
 * @param onCompleteRequest - Triggers the task-completion flow / タスク完了フローを起動する
 */
export function WorkflowFileContent({
  isLoading,
  activeFile,
  activeTabConfig,
  showApprovalButton,
  showCompleteButton,
  onPlanApprovalRequest,
  onCompleteRequest,
}: WorkflowFileContentProps) {
  const headings = useMemo(() => extractHeadings(activeFile?.content ?? ''), [activeFile?.content]);

  // The TOC is sticky and vertical, so its height varies with the heading count.
  // Measure it and feed the value into each <h2>'s scroll-margin-top so clicked
  // links land *below* the sticky bar instead of behind it. 44px = the nav's own
  // sticky offset (top-11, which already clears the task-detail toolbar above).
  const tocRef = useRef<HTMLElement | null>(null);
  const [tocHeight, setTocHeight] = useState(0);
  // Collapsible so the sticky TOC can shrink to just its label when not in use.
  const [tocOpen, setTocOpen] = useState(true);
  useEffect(() => {
    const el = tocRef.current;
    if (!el) {
      setTocHeight(0);
      return;
    }
    const update = () => setTocHeight(el.offsetHeight);
    update();
    // ResizeObserver is absent in jsdom/older runtimes; the one-shot measure above
    // still gives a usable offset there.
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [headings, tocOpen]);
  const scrollMarginTop = tocHeight > 0 ? tocHeight + 44 + 8 : 112;

  if (isLoading && !activeFile) {
    return (
      <div className="flex items-center justify-center h-32">
        <Loader2 className="h-5 w-5 text-zinc-400 animate-spin mr-2" />
        <span className="text-sm text-zinc-500 dark:text-zinc-400">読み込み中...</span>
      </div>
    );
  }

  if (!activeFile?.exists) {
    return (
      <div className="text-center py-10">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 mb-3">
          <activeTabConfig.icon className="h-6 w-6 text-zinc-400" />
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{activeTabConfig.emptyText}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* In-file table of contents — sticky so it stays clickable after the
          content scrolls. -mx-5/px-5 cancel the parent p-5 so the background
          spans the card; top-11 sits clearly below the task-detail toolbar. */}
      {headings.length > 0 && (
        <nav
          ref={tocRef}
          className="sticky top-11 z-[5] -mx-5 -mt-5 flex flex-col gap-0.5 border-b border-zinc-200 bg-white px-5 py-2.5 dark:border-zinc-700 dark:bg-indigo-dark-900"
        >
          <button
            type="button"
            onClick={() => setTocOpen((open) => !open)}
            aria-expanded={tocOpen}
            className="flex items-center gap-1 text-[11px] font-medium text-zinc-400 transition-colors hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
          >
            <List className="h-3.5 w-3.5" />
            <span>目次</span>
            <span className="text-zinc-400/70 dark:text-zinc-500/70">({headings.length})</span>
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${tocOpen ? '' : '-rotate-90'}`}
            />
          </button>
          {tocOpen && (
            <div className="mt-1 flex flex-col gap-0.5">
              {headings.map((h) => (
                <button
                  key={h.id}
                  type="button"
                  onClick={() =>
                    document
                      .getElementById(h.id)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  title={h.text}
                  className="flex items-center gap-1.5 truncate rounded-md px-2 py-1 text-left text-xs font-medium text-zinc-600 transition-colors before:h-3 before:w-0.5 before:shrink-0 before:rounded-full before:bg-indigo-400/70 hover:bg-indigo-50 hover:text-indigo-700 dark:text-zinc-300 dark:before:bg-indigo-400/60 dark:hover:bg-indigo-900/30 dark:hover:text-indigo-300"
                >
                  {h.text}
                </button>
              ))}
            </div>
          )}
        </nav>
      )}

      {/* Markdown body */}
      <div
        className={[
          'prose dark:prose-invert max-w-none prose-sm',
          'prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100',
          'prose-headings:font-semibold prose-headings:tracking-tight',
          'prose-p:text-zinc-700 dark:prose-p:text-zinc-300 prose-p:leading-relaxed',
          'prose-li:text-zinc-700 dark:prose-li:text-zinc-300 prose-li:my-0.5',
          'prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100',
          'prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline',
          // Typography injects literal backtick quotes around inline code via
          // ::before/::after. The prose-code: variant ties its specificity and
          // loses on source order, so target `code` directly — `.x code::before`
          // outranks `.prose :where(code)::before` and reliably wins.
          '[&_code]:before:content-none [&_code]:after:content-none',
        ].join(' ')}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Section headings — give H2 / H3 a clear visual rhythm so each
            // logical block reads as its own card-like section.
            h1: ({ children, ...props }) => (
              <h1
                className="!mt-0 !mb-4 pb-2 border-b-2 border-indigo-200 dark:border-indigo-800/60 text-xl !font-bold"
                {...props}
              >
                {children}
              </h1>
            ),
            h2: ({ children, ...props }) => (
              <h2
                id={headingId(nodeToText(children))}
                style={{ scrollMarginTop }}
                className="!mt-8 !mb-3 pb-1.5 border-b border-zinc-200 dark:border-zinc-700 text-lg flex items-center gap-2 before:content-[''] before:block before:w-1 before:h-5 before:rounded-sm before:bg-indigo-500 dark:before:bg-indigo-400"
                {...props}
              >
                {children}
              </h2>
            ),
            h3: ({ children, ...props }) => (
              <h3
                className="!mt-5 !mb-2 text-base !font-semibold text-indigo-700 dark:text-indigo-300"
                {...props}
              >
                {children}
              </h3>
            ),
            h4: ({ children, ...props }) => (
              <h4
                className="!mt-4 !mb-2 text-sm !font-semibold text-zinc-800 dark:text-zinc-200"
                {...props}
              >
                {children}
              </h4>
            ),
            // Horizontal rule — make section breaks more visible.
            hr: (props) => (
              <hr
                className="!my-6 border-0 h-px bg-gradient-to-r from-transparent via-zinc-300 dark:via-zinc-600 to-transparent"
                {...props}
              />
            ),
            // Tables — bordered, header-shaded, hover-highlighted, and
            // wrapped in an overflow container so wide tables stay readable
            // on narrow screens.
            table: ({ children, ...props }) => (
              <div className="!my-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700 shadow-sm">
                <table className="!my-0 w-full text-sm border-collapse" {...props}>
                  {children}
                </table>
              </div>
            ),
            thead: ({ children, ...props }) => (
              <thead
                className="bg-zinc-50 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700"
                {...props}
              >
                {children}
              </thead>
            ),
            tbody: ({ children, ...props }) => (
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800" {...props}>
                {children}
              </tbody>
            ),
            tr: ({ children, ...props }) => (
              <tr
                className="transition-colors hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10"
                {...props}
              >
                {children}
              </tr>
            ),
            th: ({ children, ...props }) => (
              <th
                className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300 whitespace-nowrap"
                {...props}
              >
                {children}
              </th>
            ),
            td: ({ children, ...props }) => (
              <td
                className="px-3 py-2 align-top text-zinc-700 dark:text-zinc-300 [&_code]:text-[0.8em]"
                {...props}
              >
                {children}
              </td>
            ),
            // Blockquote — render as a callout box so notes / warnings stand out.
            blockquote: ({ children, ...props }) => (
              <blockquote
                className="!my-4 !pl-4 !pr-3 !py-2 border-l-4 border-amber-400 dark:border-amber-500 bg-amber-50/60 dark:bg-amber-900/15 rounded-r-md !not-italic [&>p]:!my-0 [&>p]:text-amber-900 dark:[&>p]:text-amber-200"
                {...props}
              >
                {children}
              </blockquote>
            ),
            // Lists — tighten spacing and add custom markers.
            ul: ({ children, ...props }) => (
              <ul
                className="!my-2 !pl-5 list-disc marker:text-zinc-900 dark:marker:text-zinc-100"
                {...props}
              >
                {children}
              </ul>
            ),
            ol: ({ children, ...props }) => (
              <ol
                className="!my-2 !pl-5 list-decimal marker:text-zinc-900 dark:marker:text-zinc-100 marker:font-semibold"
                {...props}
              >
                {children}
              </ol>
            ),
            // Task-list checkbox — keep it disabled but visible.
            input: ({ type, checked, ...props }) => {
              if (type === 'checkbox') {
                return (
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled
                    className="mr-2 mt-0.5 accent-indigo-600 align-middle"
                    {...props}
                  />
                );
              }
              return <input type={type} {...props} />;
            },
            // Code — distinct styling for inline vs fenced blocks.
            // NOTE: react-markdown already strips the surrounding backticks, so
            // only the inner text is rendered here. Inline code mirrors the
            // Jira/Confluence "code" mark — neutral grey chip, mono, subtle border.
            code: ({ className: codeClassName, children, ...props }) => {
              const isBlock = (codeClassName || '').includes('language-');
              if (isBlock) {
                return (
                  <code className={codeClassName} {...props}>
                    {children}
                  </code>
                );
              }
              return (
                <code
                  className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                  {...props}
                >
                  {children}
                </code>
              );
            },
            pre: ({ children, ...props }) => (
              <pre
                className="!my-3 !p-3 rounded-lg bg-zinc-900 dark:bg-zinc-950 text-zinc-100 text-xs overflow-x-auto border border-zinc-800"
                {...props}
              >
                {children}
              </pre>
            ),
          }}
        >
          {activeFile.content || ''}
        </ReactMarkdown>
      </div>

      {/* Plan approval CTA (inside content area) */}
      {showApprovalButton && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 border border-amber-200 dark:border-amber-800">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                計画の承認が必要です
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
                内容を確認して承認すると実装フェーズに移行します
              </p>
            </div>
            <button
              onClick={onPlanApprovalRequest}
              className="bg-amber-600 hover:bg-amber-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              承認して実装開始
            </button>
          </div>
        </div>
      )}

      {/* Verification complete CTA (inside content area) */}
      {showCompleteButton && (
        <div className="mt-4 pt-4 border-t border-zinc-200 dark:border-zinc-700">
          <div className="flex items-center justify-between bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
            <div>
              <p className="text-sm font-medium text-green-900 dark:text-green-200">
                検証レポートの確認
              </p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">
                実装と検証が完了していればタスクを完了にします
              </p>
            </div>
            <button
              onClick={onCompleteRequest}
              className="bg-green-600 hover:bg-green-700 text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap"
            >
              実装完了
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
