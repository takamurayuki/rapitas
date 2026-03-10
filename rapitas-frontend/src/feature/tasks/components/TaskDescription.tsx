'use client';
import { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { createMarkdownComponents } from '@/feature/tasks/components/MarkdownComponents';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface TaskDescriptionProps {
  description: string;
  isCompact?: boolean;
  maxInitialLength?: number;
}

export default function TaskDescription({
  description,
  isCompact = false,
  maxInitialLength = 500,
}: TaskDescriptionProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // 説明文が長いかどうかを判定
  const isLongDescription = description.length > maxInitialLength;

  // 表示する説明文を決定
  const displayDescription = useMemo(() => {
    if (!isLongDescription || isExpanded) {
      return description;
    }

    // 最初の段落または指定文字数で切り取る
    const firstParagraphEnd = description.indexOf('\n\n');
    if (firstParagraphEnd > 0 && firstParagraphEnd <= maxInitialLength) {
      return description.substring(0, firstParagraphEnd);
    }

    // 単語の境界で切り取る
    let cutoffIndex = maxInitialLength;
    while (
      cutoffIndex > 0 &&
      description[cutoffIndex] !== ' ' &&
      description[cutoffIndex] !== '\n'
    ) {
      cutoffIndex--;
    }

    return description.substring(0, cutoffIndex || maxInitialLength) + '...';
  }, [description, isLongDescription, isExpanded, maxInitialLength]);

  return (
    <div className="relative">
      <div
        className={`prose prose-sm prose-zinc dark:prose-invert max-w-none
        ${isCompact ? 'prose-compact' : ''}
        prose-headings:font-bold
        prose-h1:text-2xl prose-h1:mt-4 prose-h1:mb-2
        prose-h2:text-xl prose-h2:mt-3 prose-h2:mb-2
        prose-h3:text-lg prose-h3:mt-2 prose-h3:mb-1
        prose-p:my-2 prose-p:leading-relaxed
        prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline
        prose-pre:bg-zinc-100 prose-pre:dark:bg-indigo-dark-800
        prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
        prose-blockquote:border-l-4 prose-blockquote:border-zinc-300
        prose-blockquote:dark:border-zinc-700 prose-blockquote:pl-4
        prose-blockquote:italic prose-blockquote:text-zinc-600
        prose-blockquote:dark:text-zinc-400
        prose-ul:my-2 prose-ol:my-2
        prose-li:my-1
        prose-table:border-collapse prose-table:w-full
        prose-th:border prose-th:border-zinc-300 prose-th:dark:border-zinc-700
        prose-th:bg-zinc-100 prose-th:dark:bg-indigo-dark-800 prose-th:px-3 prose-th:py-2
        prose-td:border prose-td:border-zinc-300 prose-td:dark:border-zinc-700
        prose-td:px-3 prose-td:py-2
        prose-img:rounded-lg prose-img:shadow-md
        prose-hr:border-zinc-300 prose-hr:dark:border-zinc-700
        [&_code]:bg-zinc-100 [&_code]:dark:bg-indigo-dark-800
        [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
        [&_code]:text-sm [&_code]:font-mono
        [&_code]:text-zinc-800 [&_code]:dark:text-zinc-200
        [&_code]:before:content-[''] [&_code]:after:content-['']
        [&_pre_code]:bg-transparent [&_pre_code]:p-0`}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkBreaks]}
          components={createMarkdownComponents()}
        >
          {displayDescription}
        </ReactMarkdown>
      </div>

      {isLongDescription && (
        <div className="mt-3 flex justify-center">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 rounded-lg transition-colors"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-4 h-4" />
                折りたたむ
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                もっと見る
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
