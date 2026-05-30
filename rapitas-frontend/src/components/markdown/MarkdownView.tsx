'use client';

/**
 * MarkdownView
 *
 * Shared Markdown renderer used by the workflow file viewer and the AI copilot
 * so both display Markdown identically — heading rhythm (indigo H2 bar), black
 * list markers, Jira-style inline code, bordered tables, callout blockquotes.
 * Optional heading-id / scroll-margin hooks support the workflow viewer's
 * in-file table of contents; other callers omit them.
 */

import { isValidElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Flattens a ReactMarkdown heading's children into plain text. / 子要素を素テキスト化。 */
export function nodeToText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeToText).join('');
  if (isValidElement(node)) {
    return nodeToText((node.props as { children?: ReactNode }).children);
  }
  return '';
}

interface MarkdownViewProps {
  /** Raw markdown to render. */
  content: string;
  /** Extra classes appended to the prose wrapper. */
  className?: string;
  /** Optional: derive a stable id for each H2 (for an in-file table of contents). */
  getHeadingId?: (text: string) => string;
  /** Optional: scroll-margin-top (px) on H2 so sticky bars don't cover the target. */
  headingScrollMarginTop?: number;
}

const PROSE_CLASS = [
  'prose dark:prose-invert max-w-none prose-sm',
  'prose-headings:text-zinc-900 dark:prose-headings:text-zinc-100',
  'prose-headings:font-semibold prose-headings:tracking-tight',
  'prose-p:text-zinc-700 dark:prose-p:text-zinc-300 prose-p:leading-relaxed',
  'prose-li:text-zinc-700 dark:prose-li:text-zinc-300 prose-li:my-0.5',
  'prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100',
  'prose-a:text-indigo-600 dark:prose-a:text-indigo-400 prose-a:no-underline hover:prose-a:underline',
  // Typography injects literal backtick quotes around inline code via
  // ::before/::after. Target `code` directly — `.x code::before` outranks
  // `.prose :where(code)::before` and reliably removes them.
  '[&_code]:before:content-none [&_code]:after:content-none',
].join(' ');

/**
 * Renders markdown with the shared rapitas styling.
 *
 * @param content - Raw markdown source / Markdown原文
 * @param className - Extra wrapper classes / 追加クラス
 * @param getHeadingId - Optional H2 id resolver / H2のid解決関数（任意）
 * @param headingScrollMarginTop - Optional H2 scroll-margin-top in px / H2のスクロール余白（任意）
 */
export function MarkdownView({
  content,
  className = '',
  getHeadingId,
  headingScrollMarginTop,
}: MarkdownViewProps) {
  return (
    <div className={`${PROSE_CLASS} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
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
              id={getHeadingId ? getHeadingId(nodeToText(children)) : undefined}
              style={
                headingScrollMarginTop !== undefined
                  ? { scrollMarginTop: headingScrollMarginTop }
                  : undefined
              }
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
          hr: (props) => (
            <hr
              className="!my-6 border-0 h-px bg-gradient-to-r from-transparent via-zinc-300 dark:via-zinc-600 to-transparent"
              {...props}
            />
          ),
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
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="!my-4 !pl-4 !pr-3 !py-2 border-l-4 border-amber-400 dark:border-amber-500 bg-amber-50/60 dark:bg-amber-900/15 rounded-r-md !not-italic [&>p]:!my-0 [&>p]:text-amber-900 dark:[&>p]:text-amber-200"
              {...props}
            >
              {children}
            </blockquote>
          ),
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
          // NOTE: react-markdown strips the surrounding backticks, so only the
          // inner text renders. Inline code mirrors the Jira/Confluence mark.
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
        {content}
      </ReactMarkdown>
    </div>
  );
}
