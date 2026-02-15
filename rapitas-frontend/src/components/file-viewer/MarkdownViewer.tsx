"use client";
import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check, List, ExternalLink } from "lucide-react";
import "highlight.js/styles/github-dark.css";

type MarkdownViewerProps = {
  content: string;
  className?: string;
  showToc?: boolean;
};

type TocItem = {
  id: string;
  text: string;
  level: number;
};

export default function MarkdownViewer({ content, className = "", showToc = true }: MarkdownViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showTocPanel, setShowTocPanel] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 目次の生成
  useEffect(() => {
    const headings: TocItem[] = [];
    const lines = content.split('\n');
    let idCounter = 0;

    lines.forEach((line) => {
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const level = match[1].length;
        const text = match[2];
        headings.push({
          id: `heading-${idCounter++}`,
          text,
          level,
        });
      }
    });

    setToc(headings);
  }, [content]);

  // コードコピー機能
  const handleCopyCode = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(id);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  // 目次のスクロール
  const scrollToHeading = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setShowTocPanel(false);
    }
  };

  if (!mounted) {
    return <div className="animate-pulse bg-zinc-100 dark:bg-zinc-800 h-96 rounded" />;
  }

  let headingCounter = 0;

  return (
    <div className={`markdown-viewer relative ${className}`}>
      {/* 目次トグルボタン */}
      {showToc && toc.length > 0 && (
        <button
          onClick={() => setShowTocPanel(!showTocPanel)}
          className="fixed right-8 top-32 z-40 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 border border-zinc-200 dark:border-zinc-700"
          title="目次"
        >
          <List className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
        </button>
      )}

      {/* 目次パネル */}
      {showToc && showTocPanel && (
        <div className="fixed right-8 top-44 z-40 w-72 max-h-[70vh] bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">目次</h3>
          </div>
          <div className="overflow-y-auto max-h-[calc(70vh-60px)] p-4">
            {toc.map((item) => (
              <button
                key={item.id}
                onClick={() => scrollToHeading(item.id)}
                className={`block w-full text-left py-1.5 px-3 rounded hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors ${
                  item.level === 1 ? 'font-semibold' : ''
                }`}
                style={{ paddingLeft: `${(item.level - 1) * 16 + 12}px` }}
              >
                <span className="text-sm text-zinc-700 dark:text-zinc-300 line-clamp-2">
                  {item.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div ref={contentRef} className="prose prose-zinc dark:prose-invert max-w-none">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={{
          // カスタムコンポーネントの定義
          h1: ({ children, ...props }) => {
            const id = `heading-${headingCounter++}`;
            return (
              <h1 id={id} className="text-3xl font-bold mb-6 text-zinc-900 dark:text-zinc-100 scroll-mt-20" {...props}>
                {children}
              </h1>
            );
          },
          h2: ({ children, ...props }) => {
            const id = `heading-${headingCounter++}`;
            return (
              <h2 id={id} className="text-2xl font-semibold mb-4 mt-8 text-zinc-800 dark:text-zinc-200 scroll-mt-20" {...props}>
                {children}
              </h2>
            );
          },
          h3: ({ children, ...props }) => {
            const id = `heading-${headingCounter++}`;
            return (
              <h3 id={id} className="text-xl font-semibold mb-3 mt-6 text-zinc-800 dark:text-zinc-200 scroll-mt-20" {...props}>
                {children}
              </h3>
            );
          },
          h4: ({ children, ...props }) => {
            const id = `heading-${headingCounter++}`;
            return (
              <h4 id={id} className="text-lg font-semibold mb-2 mt-4 text-zinc-800 dark:text-zinc-200 scroll-mt-20" {...props}>
                {children}
              </h4>
            );
          },
          p: ({ children, ...props }) => (
            <p className="mb-4 text-zinc-700 dark:text-zinc-300 leading-relaxed" {...props}>
              {children}
            </p>
          ),
          a: ({ href, children, ...props }) => {
            const isExternal = href?.startsWith("http");
            return (
              <a
                href={href}
                className="text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                {...props}
              >
                {children}
                {isExternal && (
                  <ExternalLink className="w-3 h-3 opacity-70" />
                )}
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
              {children}
            </li>
          ),
          blockquote: ({ children, ...props }) => (
            <blockquote
              className="border-l-4 border-zinc-300 dark:border-zinc-600 pl-4 my-4 italic text-zinc-600 dark:text-zinc-400"
              {...props}
            >
              {children}
            </blockquote>
          ),
          code: ({ className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || "");
            const isInline = !match;

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

            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
          pre: ({ children, ...props }) => {
            const codeElement = (children as any)?.props;
            const codeContent = codeElement?.children?.toString() || '';
            const codeId = `code-${Math.random().toString(36).substr(2, 9)}`;

            return (
              <div className="relative group mb-4">
                <pre
                  className="bg-zinc-900 dark:bg-zinc-950 rounded-lg p-4 overflow-x-auto"
                  {...props}
                >
                  {children}
                </pre>
                {codeContent && (
                  <button
                    onClick={() => handleCopyCode(codeContent, codeId)}
                    className="absolute top-2 right-2 p-2 bg-zinc-800 dark:bg-zinc-700 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-zinc-700 dark:hover:bg-zinc-600"
                    title="コードをコピー"
                  >
                    {copiedCode === codeId ? (
                      <Check className="w-4 h-4 text-green-400" />
                    ) : (
                      <Copy className="w-4 h-4 text-zinc-300" />
                    )}
                  </button>
                )}
              </div>
            );
          },
          table: ({ children, ...props }) => (
            <div className="overflow-x-auto mb-4">
              <table className="min-w-full border border-zinc-200 dark:border-zinc-700" {...props}>
                {children}
              </table>
            </div>
          ),
          th: ({ children, ...props }) => (
            <th
              className="border border-zinc-200 dark:border-zinc-700 px-4 py-2 bg-zinc-50 dark:bg-zinc-800 font-semibold text-zinc-800 dark:text-zinc-200"
              {...props}
            >
              {children}
            </th>
          ),
          td: ({ children, ...props }) => (
            <td
              className="border border-zinc-200 dark:border-zinc-700 px-4 py-2 text-zinc-700 dark:text-zinc-300"
              {...props}
            >
              {children}
            </td>
          ),
          hr: () => (
            <hr className="border-t border-zinc-200 dark:border-zinc-700 my-8" />
          ),
          img: ({ src, alt, ...props }) => (
            <img
              src={src}
              alt={alt || ""}
              className="rounded-lg shadow-md max-w-full h-auto my-4"
              loading="lazy"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      </div>
    </div>
  );
}