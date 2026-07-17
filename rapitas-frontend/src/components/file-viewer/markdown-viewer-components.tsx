'use client';

/**
 * markdown-viewer-components
 *
 * react-markdown component-override factory for the file viewer's
 * MarkdownViewer: heading ids for the ToC, syntax-highlighted code blocks with
 * copy button, and status-emoji → lucide icon substitution. Not responsible
 * for viewer state (ToC panel, copy state) — the caller injects those.
 */

import type { Components } from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check, ExternalLink } from 'lucide-react';
import { renderTextWithEmojiIcons } from '@/components/markdown/emoji-to-lucide';
import { renderBlockWithEmojiIcons } from '@/components/markdown/verdict-chip';

export interface MarkdownViewerComponentDeps {
  /** Returns the next sequential heading id (ToC anchor). / 次の見出しID */
  nextHeadingId: () => string;
  /** Whether the dark syntax theme should be used. / ダークテーマ使用可否 */
  isDarkMode: boolean;
  /** Id of the code block just copied, if any. / コピー済みコードブロックID */
  copiedCode: string | null;
  /** Copies a code block and tracks the copied id. / コードコピー処理 */
  onCopyCode: (code: string, id: string) => void;
  /** Localized tooltip for the copy button. / コピーボタンのラベル */
  copyCodeLabel: string;
}

/**
 * Builds the component-override map for MarkdownViewer's ReactMarkdown.
 * Call once per render — the heading-id counter must restart each render.
 *
 * @param deps - Viewer state and callbacks injected by MarkdownViewer. / ビューア側の状態とコールバック
 * @returns react-markdown `components` map. / react-markdownのcomponentsマップ
 */
export function createMarkdownViewerComponents(deps: MarkdownViewerComponentDeps): Components {
  const { nextHeadingId, isDarkMode, copiedCode, onCopyCode, copyCodeLabel } = deps;
  return {
    h1: ({ children, ...props }) => (
      <h1
        id={nextHeadingId()}
        className="text-3xl font-bold mb-6 text-zinc-900 dark:text-zinc-100 scroll-mt-20"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </h1>
    ),
    h2: ({ children, ...props }) => (
      <h2
        id={nextHeadingId()}
        className="text-2xl font-semibold mb-4 mt-8 text-zinc-800 dark:text-zinc-200 scroll-mt-20"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </h2>
    ),
    h3: ({ children, ...props }) => (
      <h3
        id={nextHeadingId()}
        className="text-xl font-semibold mb-3 mt-6 text-zinc-800 dark:text-zinc-200 scroll-mt-20"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </h3>
    ),
    h4: ({ children, ...props }) => (
      <h4
        id={nextHeadingId()}
        className="text-lg font-semibold mb-2 mt-4 text-zinc-800 dark:text-zinc-200 scroll-mt-20"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </h4>
    ),
    h5: ({ children, ...props }) => <h5 {...props}>{renderTextWithEmojiIcons(children)}</h5>,
    h6: ({ children, ...props }) => <h6 {...props}>{renderTextWithEmojiIcons(children)}</h6>,
    p: ({ children, ...props }) => (
      <p className="mb-4 text-zinc-700 dark:text-zinc-300 leading-relaxed" {...props}>
        {renderBlockWithEmojiIcons(children)}
      </p>
    ),
    strong: ({ children, ...props }) => (
      <strong {...props}>{renderTextWithEmojiIcons(children)}</strong>
    ),
    em: ({ children, ...props }) => <em {...props}>{renderTextWithEmojiIcons(children)}</em>,
    a: ({ href, children, ...props }) => {
      const isExternal = href?.startsWith('http');
      return (
        <a
          href={href}
          className="text-indigo-600 dark:text-indigo-400 hover:underline inline-flex items-center gap-1"
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          {...props}
        >
          {children}
          {isExternal && <ExternalLink className="w-3 h-3 opacity-70" />}
        </a>
      );
    },
    ul: ({ children, ...props }) => (
      <ul className="list-disc pl-6 mb-4 space-y-1 text-zinc-700 dark:text-zinc-300" {...props}>
        {children}
      </ul>
    ),
    ol: ({ children, ...props }) => (
      <ol className="list-decimal pl-6 mb-4 space-y-1 text-zinc-700 dark:text-zinc-300" {...props}>
        {children}
      </ol>
    ),
    li: ({ children, ...props }) => (
      <li className="leading-relaxed" {...props}>
        {renderBlockWithEmojiIcons(children)}
      </li>
    ),
    blockquote: ({ children, ...props }) => (
      <blockquote
        className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 my-4 italic text-zinc-600 dark:text-zinc-400"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </blockquote>
    ),
    code: ({ className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const isInline = !className?.includes('language-');

      if (isInline) {
        return (
          <code
            className="px-1.5 py-0.5 bg-zinc-100 dark:bg-zinc-800 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200"
            {...props}
          >
            {children}
          </code>
        );
      }

      const codeString = String(children).replace(/\n$/, '');
      const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;

      return (
        <div className="relative group mb-4">
          <SyntaxHighlighter
            style={isDarkMode ? oneDark : oneLight}
            language={language || 'text'}
            customStyle={{
              margin: 0,
              borderRadius: '0.5rem',
              fontSize: '0.875rem',
            }}
            showLineNumbers={false}
          >
            {codeString}
          </SyntaxHighlighter>
          <button
            onClick={() => onCopyCode(codeString, codeId)}
            className="absolute top-2 right-2 p-2 bg-zinc-800 dark:bg-zinc-700 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-zinc-700 dark:hover:bg-zinc-600"
            title={copyCodeLabel}
          >
            {copiedCode === codeId ? (
              <Check className="w-4 h-4 text-green-400" />
            ) : (
              <Copy className="w-4 h-4 text-zinc-300" />
            )}
          </button>
        </div>
      );
    },
    pre: ({ children, ...props }: { children?: React.ReactNode }) => {
      return <pre {...props}>{children}</pre>;
    },
    // NOTE: table-auto sizes columns by content (numbers stay narrow, paths get
    // the width) while wrapping cells keep every column visible without
    // horizontal scrolling; overflow-x-auto remains only as a last-resort guard.
    table: ({ children, ...props }) => (
      <div className="overflow-x-auto mb-4">
        <table
          className="w-full table-auto text-xs border border-zinc-200 dark:border-zinc-700"
          {...props}
        >
          {children}
        </table>
      </div>
    ),
    // Subtle vertical column separators, same tone as the horizontal borders.
    tr: ({ children, ...props }) => (
      <tr className="divide-x divide-zinc-200 dark:divide-zinc-700/60" {...props}>
        {children}
      </tr>
    ),
    th: ({ children, ...props }) => (
      <th
        className="border-b border-zinc-200 dark:border-zinc-700 px-2 py-1 text-left align-top text-xs font-medium text-zinc-500 dark:text-zinc-400 whitespace-normal [overflow-wrap:anywhere]"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </th>
    ),
    td: ({ children, ...props }) => (
      <td
        className="border-b border-zinc-100 dark:border-zinc-800 px-2 py-1 align-top text-zinc-700 dark:text-zinc-300 whitespace-normal [overflow-wrap:anywhere]"
        {...props}
      >
        {renderTextWithEmojiIcons(children)}
      </td>
    ),
    hr: () => <hr className="border-t border-zinc-200 dark:border-zinc-700 my-8" />,
    img: ({ src, alt, ...props }) => (
      // NOTE: renders arbitrary image URLs embedded in user-authored markdown —
      // unknown dimensions and arbitrary source hosts not covered by
      // next.config's image remotePatterns, so next/image isn't a safe swap.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt || ''}
        className="rounded-lg shadow-md max-w-full h-auto my-4"
        loading="lazy"
        {...props}
      />
    ),
  };
}
