/**
 * MarkdownComponents
 *
 * react-markdown component overrides for task text (descriptions, notes):
 * syntax-highlighted code blocks, rapitas-note chip links, and status-emoji →
 * lucide icon substitution (shared module — see components/markdown).
 */

import type { ReactNode, HTMLAttributes } from 'react';
import { NoteChipLink } from '../NoteChipLink';
import {
  isIconOnlyCellContent,
  renderTableCellContent,
  renderTextWithEmojiIcons,
  unwrapFullQuotes,
} from '@/components/markdown/emoji-to-lucide';
import { renderBlockWithEmojiIcons } from '@/components/markdown/verdict-chip';
import { MermaidBlock, extractMermaidSource } from '@/components/markdown/mermaid-block';
import { LazySyntaxHighlighter } from '@/components/markdown/lazy-syntax-highlighter';

type MarkdownNode = {
  children?: Array<{
    type: string;
    tagName?: string;
  }>;
};

type ParagraphProps = HTMLAttributes<HTMLParagraphElement> & {
  node?: MarkdownNode;
  children?: ReactNode;
};

type CodeProps = HTMLAttributes<HTMLElement> & {
  node?: MarkdownNode;
  inline?: boolean;
  className?: string;
  children?: ReactNode;
};

type LinkProps = HTMLAttributes<HTMLAnchorElement> & {
  href?: string;
  children?: ReactNode;
};

// Custom components for Markdown rendering
export const createMarkdownComponents = () => ({
  // NOTE: Customize p tag handling (convert to div when containing pre/code)
  p({ node, children, ...props }: ParagraphProps) {
    // Check if child elements contain pre or code blocks
    const hasCodeBlock = node?.children?.some(
      (child) => child.type === 'element' && (child.tagName === 'pre' || child.tagName === 'code'),
    );

    if (hasCodeBlock) {
      return <div {...props}>{children}</div>;
    }
    return <p {...props}>{renderBlockWithEmojiIcons(children)}</p>;
  },
  // NOTE: Pass-through overrides exist only to run the shared emoji→icon
  // substitution on text children; default styling is unchanged.
  li({ children, ...props }: HTMLAttributes<HTMLLIElement> & { children?: ReactNode }) {
    return <li {...props}>{renderBlockWithEmojiIcons(children)}</li>;
  },
  h1({ children, ...props }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) {
    return <h1 {...props}>{renderTextWithEmojiIcons(children)}</h1>;
  },
  h2({ children, ...props }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) {
    return <h2 {...props}>{renderTextWithEmojiIcons(children)}</h2>;
  },
  h3({ children, ...props }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) {
    return <h3 {...props}>{renderTextWithEmojiIcons(children)}</h3>;
  },
  h4({ children, ...props }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) {
    return <h4 {...props}>{renderTextWithEmojiIcons(children)}</h4>;
  },
  h5({ children, ...props }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) {
    return <h5 {...props}>{renderTextWithEmojiIcons(children)}</h5>;
  },
  h6({ children, ...props }: HTMLAttributes<HTMLHeadingElement> & { children?: ReactNode }) {
    return <h6 {...props}>{renderTextWithEmojiIcons(children)}</h6>;
  },
  strong({ children, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
    return <strong {...props}>{renderTextWithEmojiIcons(children)}</strong>;
  },
  em({ children, ...props }: HTMLAttributes<HTMLElement> & { children?: ReactNode }) {
    return <em {...props}>{renderTextWithEmojiIcons(children)}</em>;
  },
  // NOTE: table-auto sizes columns by content (numbers stay narrow, paths get
  // the width) while wrapping cells keep every column visible without
  // horizontal scrolling; overflow-x-auto remains only as a last-resort guard.
  table({ children, ...props }: HTMLAttributes<HTMLTableElement> & { children?: ReactNode }) {
    return (
      <div className="overflow-x-auto my-4">
        <table className="w-full table-auto text-xs border-collapse" {...props}>
          {children}
        </table>
      </div>
    );
  },
  // Subtle vertical column separators, same tone as the horizontal borders.
  tr({ children, ...props }: HTMLAttributes<HTMLTableRowElement> & { children?: ReactNode }) {
    return (
      <tr className="divide-x divide-zinc-200 dark:divide-zinc-700/60" {...props}>
        {children}
      </tr>
    );
  },
  td({ children, ...props }: HTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
    const content = unwrapFullQuotes(children);
    return (
      <td
        className={`border-b border-zinc-100 dark:border-zinc-800 px-2 py-1 align-top text-zinc-700 dark:text-zinc-300 whitespace-normal [overflow-wrap:anywhere] [&_code]:text-[0.85em] [&_code]:break-all ${isIconOnlyCellContent(content) ? 'text-center' : ''}`}
        {...props}
      >
        {renderTableCellContent(content)}
      </td>
    );
  },
  th({ children, ...props }: HTMLAttributes<HTMLTableCellElement> & { children?: ReactNode }) {
    const content = unwrapFullQuotes(children);
    return (
      <th
        className="bg-zinc-100 dark:bg-zinc-800/80 border-b border-zinc-200 dark:border-zinc-700 px-2 py-1 text-left align-top font-medium text-zinc-600 dark:text-zinc-300 whitespace-normal [overflow-wrap:anywhere]"
        {...props}
      >
        {renderTableCellContent(content)}
      </th>
    );
  },
  blockquote({ children, ...props }: HTMLAttributes<HTMLQuoteElement> & { children?: ReactNode }) {
    return <blockquote {...props}>{renderTextWithEmojiIcons(children)}</blockquote>;
  },
  code({ inline, className, children, style: _style, ...props }: CodeProps) {
    const match = /language-(\w+)/.exec(className || '');
    const language = match ? match[1] : '';
    const codeString = String(children).replace(/\n$/, '');
    // NOTE: _style is unused (conflicts with SyntaxHighlighter's style prop)
    void _style;

    // Inline code
    if (inline) {
      return (
        <code
          className="inline bg-zinc-100 dark:bg-indigo-dark-800 px-1.5 py-0.5 rounded text-sm font-mono text-zinc-800 dark:text-zinc-200"
          {...props}
        >
          {children}
        </code>
      );
    }

    // Code block (with language)
    if (language) {
      return (
        <div className="relative group my-4">
          <div className="absolute top-0 right-0">
            <span className="px-3 py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-indigo-dark-800 rounded-bl-lg border-l border-b border-zinc-300 dark:border-zinc-700">
              {language.toUpperCase()}
            </span>
          </div>
          {/* NOTE: react-markdown's inert {...props} are no longer forwarded to the
              highlighter — it renders from the explicit props below (bundle-budget
              lazy split; see lazy-syntax-highlighter). */}
          <LazySyntaxHighlighter
            code={codeString}
            language={language}
            theme="vscDarkPlus"
            preTag="div"
            className="mt-0! mb-0! rounded-lg! text-sm!"
            showLineNumbers={true}
            customStyle={{
              margin: 0,
              borderRadius: '0.5rem',
              padding: '1rem',
            }}
          />
        </div>
      );
    }

    // Code block (without language)
    return (
      <div className="bg-zinc-100 dark:bg-indigo-dark-800 p-4 rounded-lg overflow-x-auto my-4">
        <code
          className="block text-sm font-mono text-zinc-800 dark:text-zinc-200 whitespace-pre"
          {...props}
        >
          {children}
        </code>
      </div>
    );
  },
  // ```mermaid fences render as diagrams; other fences keep the default <pre>.
  pre({
    node,
    children,
    ...props
  }: HTMLAttributes<HTMLPreElement> & { node?: MarkdownNode; children?: ReactNode }) {
    const mermaidSource = extractMermaidSource(node);
    if (mermaidSource !== null) return <MermaidBlock source={mermaidSource} />;
    return <pre {...props}>{children}</pre>;
  },
  // NOTE: Customize link handling — rapitas-note links render a Confluence-style chip.
  // New format: /rapitas-note/{taskId}/{noteId} (relative URL, not filtered by react-markdown).
  // Old format: rapitas-note://{noteId} (backward compat — needs urlTransform to pass through).
  a({ href, children, ...props }: LinkProps) {
    const text = Array.isArray(children)
      ? children.map((c) => (typeof c === 'string' ? c : '')).join('')
      : typeof children === 'string'
        ? children
        : '';

    if (href?.startsWith('/rapitas-note/')) {
      const parts = href.slice('/rapitas-note/'.length).split('/');
      const taskId = parts[0];
      const noteId = parts[1];
      return <NoteChipLink noteId={noteId} taskId={taskId} fallbackTitle={text} />;
    }
    // NOTE: Old format — rapitas-note:// is blocked by defaultUrlTransform unless
    // TaskDescription passes urlTransform={(v) => v.startsWith('rapitas-note://') ? v : ...}.
    if (href?.startsWith('rapitas-note://')) {
      const noteId = href.slice('rapitas-note://'.length);
      return <NoteChipLink noteId={noteId} fallbackTitle={text} />;
    }
    // NOTE: ExternalLinksProvider sets handlers globally; only handle styling here.
    return (
      <a href={href} className="text-blue-600 dark:text-blue-400 hover:underline" {...props}>
        {children}
      </a>
    );
  },
});
