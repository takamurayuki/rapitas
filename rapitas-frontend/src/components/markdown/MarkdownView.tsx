'use client';

/**
 * MarkdownView
 *
 * Shared Markdown renderer used by the workflow file viewer and the AI copilot
 * so both display Markdown identically — heading rhythm (indigo H2 bar), black
 * list markers, Jira-style inline code, bordered tables, callout blockquotes,
 * and status-emoji → lucide icon substitution (see ./emoji-to-lucide).
 * Optional heading-id / scroll-margin hooks support the workflow viewer's
 * in-file table of contents; other callers omit them.
 */

import { isValidElement, memo, useMemo, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  isIconOnlyCellContent,
  renderTableCellContent,
  renderTextWithEmojiIcons,
  unwrapFullQuotes,
} from './emoji-to-lucide';
import { renderBlockWithEmojiIcons } from './verdict-chip';
import { MermaidBlock, extractMermaidSource } from './mermaid-block';

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
  'prose dark:prose-invert max-w-none prose-sm [overflow-wrap:anywhere]',
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
function MarkdownViewImpl({
  content,
  className = '',
  getHeadingId,
  headingScrollMarginTop,
}: MarkdownViewProps) {
  // Stabilized so its identity doesn't change every render — react-markdown
  // re-parses/re-reconciles the whole tree whenever `components` is a new
  // object, which otherwise happened on every parent re-render even when
  // nothing about the content actually changed.
  const components = useMemo<Components>(
    () => ({
      h1: ({ children, ...props }) => (
        <h1
          className="!mt-0 !mb-4 pb-2 border-b-2 border-indigo-200 dark:border-indigo-800/60 text-xl !font-bold"
          {...props}
        >
          {renderTextWithEmojiIcons(unwrapFullQuotes(children))}
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
          {renderTextWithEmojiIcons(unwrapFullQuotes(children))}
        </h2>
      ),
      h3: ({ children, ...props }) => (
        <h3
          className="!mt-5 !mb-2 text-base !font-semibold text-indigo-700 dark:text-indigo-300"
          {...props}
        >
          {renderTextWithEmojiIcons(unwrapFullQuotes(children))}
        </h3>
      ),
      h4: ({ children, ...props }) => (
        <h4
          className="!mt-4 !mb-2 text-sm !font-semibold text-zinc-800 dark:text-zinc-200"
          {...props}
        >
          {renderTextWithEmojiIcons(unwrapFullQuotes(children))}
        </h4>
      ),
      h5: ({ children, ...props }) => (
        <h5 {...props}>{renderTextWithEmojiIcons(unwrapFullQuotes(children))}</h5>
      ),
      h6: ({ children, ...props }) => (
        <h6 {...props}>{renderTextWithEmojiIcons(unwrapFullQuotes(children))}</h6>
      ),
      p: ({ children, ...props }) => <p {...props}>{renderBlockWithEmojiIcons(children)}</p>,
      li: ({ children, ...props }) => <li {...props}>{renderBlockWithEmojiIcons(children)}</li>,
      strong: ({ children, ...props }) => (
        <strong {...props}>{renderTextWithEmojiIcons(children)}</strong>
      ),
      em: ({ children, ...props }) => <em {...props}>{renderTextWithEmojiIcons(children)}</em>,
      hr: (props) => (
        <hr
          className="!my-6 border-0 h-px bg-gradient-to-r from-transparent via-zinc-300 dark:via-zinc-600 to-transparent"
          {...props}
        />
      ),
      // NOTE: table-auto sizes columns by content (numbers stay narrow,
      // paths get the width) while wrapping cells keep every column visible
      // without horizontal scrolling; the overflow-x-auto wrapper remains
      // only as a last-resort guard for pathological content.
      table: ({ children, ...props }) => (
        <div className="!my-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
          <table className="!my-0 w-full table-auto text-xs border-collapse" {...props}>
            {children}
          </table>
        </div>
      ),
      thead: ({ children, ...props }) => (
        <thead
          className="bg-zinc-100 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700"
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
          className="divide-x divide-zinc-200 dark:divide-zinc-700/60 transition-colors hover:bg-indigo-50/40 dark:hover:bg-indigo-900/10"
          {...props}
        >
          {children}
        </tr>
      ),
      th: ({ children, ...props }) => {
        const content = unwrapFullQuotes(children);
        return (
          <th
            className="px-2 py-1 text-left align-top text-xs font-medium text-zinc-600 dark:text-zinc-300 whitespace-normal [overflow-wrap:anywhere]"
            {...props}
          >
            {renderTableCellContent(content)}
          </th>
        );
      },
      td: ({ children, ...props }) => {
        const content = unwrapFullQuotes(children);
        return (
          <td
            className={`px-2 py-1 align-top text-zinc-700 dark:text-zinc-300 whitespace-normal [overflow-wrap:anywhere] [&_code]:text-[0.8em] [&_code]:break-all ${isIconOnlyCellContent(content) ? 'text-center' : ''}`}
            {...props}
          >
            {renderTableCellContent(content)}
          </td>
        );
      },
      // NOTE: amber stays only as the border/bg ACCENT — body text is neutral
      // zinc. The old amber-900/amber-200 text read poorly ("orange sections").
      blockquote: ({ children, ...props }) => (
        <blockquote
          className="!my-4 !pl-4 !pr-3 !py-2 border-l-4 border-amber-500 dark:border-amber-500/70 bg-amber-50/60 dark:bg-amber-950/30 rounded-r-md !not-italic [&>p]:!my-0 [&>p]:text-zinc-700 dark:[&>p]:text-zinc-300"
          {...props}
        >
          {renderTextWithEmojiIcons(children)}
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
            className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 font-mono text-[0.85em] text-zinc-800 [overflow-wrap:anywhere] dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            {...props}
          >
            {children}
          </code>
        );
      },
      pre: ({ children, node, ...props }) => {
        // ```mermaid fences render as diagrams instead of code blocks.
        const mermaidSource = extractMermaidSource(node);
        if (mermaidSource !== null) return <MermaidBlock source={mermaidSource} />;
        // Light mode uses a LIGHT code block (dark text on soft gray) so a
        // fenced block — e.g. a pasted commit message — doesn't render as a
        // jarring hard-to-read black box on the light theme. Dark mode keeps
        // the near-black block (light text), which already reads fine.
        return (
          <pre
            className="!my-3 !p-3 rounded-lg border border-zinc-200 bg-zinc-100 text-zinc-800 text-xs overflow-x-auto dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
            {...props}
          >
            {children}
          </pre>
        );
      },
    }),
    [getHeadingId, headingScrollMarginTop],
  );

  return (
    <div className={`${PROSE_CLASS} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

/**
 * Memoized so an unchanged `content` string (guaranteed on identical polls by
 * useWorkflowFiles' equality guard) skips a re-render entirely, instead of
 * re-running the full markdown parse/reconcile (and any Mermaid diagrams
 * inside) on every parent re-render.
 */
export const MarkdownView = memo(MarkdownViewImpl);
