import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import type { ReactNode, HTMLAttributes, CSSProperties } from 'react';

// vscDarkPlus style type
type SyntaxHighlighterStyle = { [key: string]: CSSProperties };

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
      (child) =>
        child.type === 'element' &&
        (child.tagName === 'pre' || child.tagName === 'code'),
    );

    if (hasCodeBlock) {
      return <div {...props}>{children}</div>;
    }
    return <p {...props}>{children}</p>;
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
          <SyntaxHighlighter
            style={vscDarkPlus as unknown as SyntaxHighlighterStyle}
            language={language}
            PreTag="div"
            className="mt-0! mb-0! rounded-lg! text-sm!"
            showLineNumbers={true}
            customStyle={{
              margin: 0,
              borderRadius: '0.5rem',
              padding: '1rem',
            }}
            {...props}
          >
            {codeString}
          </SyntaxHighlighter>
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
  // NOTE: Customize link handling (open external links in split view)
  a({ href, children, ...props }: LinkProps) {
    // NOTE: ExternalLinksProvider sets handlers globally,
    // Only handle styling here, no additional handlers needed
    // so omitting target="_blank" prevents default browser behavior
    return (
      <a
        href={href}
        className="text-blue-600 dark:text-blue-400 hover:underline"
        {...props}
      >
        {children}
      </a>
    );
  },
});
