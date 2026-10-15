'use client';

/**
 * MarkdownViewer
 *
 * File-viewer markdown renderer: table-of-contents panel, heading anchors, and
 * copy-to-clipboard state. Component overrides (styling, code highlighting,
 * emoji→icon substitution) live in ./markdown-viewer-components.
 */

import { useEffect, useState, useRef } from 'react';
import { useTranslations } from 'next-intl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useDarkMode } from '@/hooks/ui/useDarkMode';
import { List } from 'lucide-react';
import { createLogger } from '@/lib/logger';
import { createMarkdownViewerComponents } from './markdown-viewer-components';
const logger = createLogger('MarkdownViewer');

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

export default function MarkdownViewer({
  content,
  className = '',
  showToc = true,
}: MarkdownViewerProps) {
  const [mounted, setMounted] = useState(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [toc, setToc] = useState<TocItem[]>([]);
  const [showTocPanel, setShowTocPanel] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const { isDarkMode } = useDarkMode();
  const t = useTranslations('devTools');

  useEffect(() => {
    setMounted(true);
  }, []);

  // Generate table of contents
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

  // Code copy functionality
  const handleCopyCode = async (code: string, id: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(id);
      setTimeout(() => setCopiedCode(null), 2000);
    } catch (err) {
      logger.error('Failed to copy code:', err);
    }
  };

  // Table of contents scrolling
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

  // Restart per render so heading anchors line up with the parsed ToC ids.
  let headingCounter = 0;
  const components = createMarkdownViewerComponents({
    nextHeadingId: () => `heading-${headingCounter++}`,
    isDarkMode,
    copiedCode,
    onCopyCode: handleCopyCode,
    copyCodeLabel: t('markdownViewer.copyCode'),
  });

  return (
    <div className={`markdown-viewer relative ${className}`}>
      {/* Table of contents toggle button */}
      {showToc && toc.length > 0 && (
        <button
          onClick={() => setShowTocPanel(!showTocPanel)}
          className="fixed right-8 top-32 z-40 p-2 bg-white dark:bg-zinc-800 rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 border border-zinc-200 dark:border-zinc-700"
          title={t('markdownViewer.toc')}
        >
          <List className="w-5 h-5 text-zinc-600 dark:text-zinc-400" />
        </button>
      )}

      {/* Table of contents panel */}
      {showToc && showTocPanel && (
        <div className="fixed right-8 top-44 z-40 w-72 max-h-[70vh] bg-white dark:bg-zinc-800 rounded-lg shadow-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="p-4 border-b border-zinc-200 dark:border-zinc-700">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">
              {t('markdownViewer.toc')}
            </h3>
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
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
