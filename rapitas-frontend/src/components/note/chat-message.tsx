'use client';
// ChatMessage
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Copy, Check } from 'lucide-react';
import type { AIChatMessage } from '@/types';

/**
 * Renders a user or assistant chat message bubble.
 *
 * @param message - The chat message to display / 表示するチャットメッセージ
 */
export default function ChatMessage({ message }: { message: AIChatMessage }) {
  const isUser = message.role === 'user';
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-linear-to-r from-blue-500 to-indigo-600 text-white rounded-br-md'
            : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 rounded-bl-md'
        }`}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {message.content}
          </p>
        ) : (
          <div className="text-sm leading-relaxed prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                h1: ({ children }) => (
                  <h1 className="text-xl font-bold mt-4 mb-2 text-zinc-900 dark:text-zinc-100">
                    {children}
                  </h1>
                ),
                h2: ({ children }) => (
                  <h2 className="text-lg font-semibold mt-3 mb-2 text-zinc-800 dark:text-zinc-200">
                    {children}
                  </h2>
                ),
                h3: ({ children }) => (
                  <h3 className="text-base font-semibold mt-2 mb-1 text-zinc-800 dark:text-zinc-200">
                    {children}
                  </h3>
                ),
                p: ({ children }) => (
                  <p className="mb-3 text-zinc-700 dark:text-zinc-300 leading-relaxed">
                    {children}
                  </p>
                ),
                ul: ({ children }) => (
                  <ul className="list-disc list-inside mb-3 space-y-1 text-zinc-700 dark:text-zinc-300">
                    {children}
                  </ul>
                ),
                ol: ({ children }) => (
                  <ol className="list-decimal list-inside mb-3 space-y-1 text-zinc-700 dark:text-zinc-300">
                    {children}
                  </ol>
                ),
                li: ({ children }) => (
                  <li className="ml-2">
                    <span className="ml-1">{children}</span>
                  </li>
                ),
                code: ({
                  inline,
                  className,
                  children,
                }: {
                  inline?: boolean;
                  className?: string;
                  children?: React.ReactNode;
                }) => {
                  if (inline) {
                    return (
                      <code className="px-1.5 py-0.5 mx-0.5 rounded text-sm bg-zinc-200 dark:bg-zinc-700 text-pink-600 dark:text-pink-400 font-mono">
                        {children}
                      </code>
                    );
                  }
                  const lang = className?.replace('language-', '') || 'text';
                  const codeString = String(children).replace(/\n$/, '');
                  return (
                    <div className="relative group mb-3">
                      {lang !== 'text' && (
                        <div className="absolute top-0 right-0 px-2 py-1 text-xs text-zinc-400 bg-zinc-800 rounded-tr-md rounded-bl-md z-10">
                          {lang}
                        </div>
                      )}
                      <div className="rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-700">
                        <SyntaxHighlighter
                          style={oneDark}
                          language={lang}
                          PreTag="div"
                          customStyle={{
                            margin: 0,
                            padding: '1rem',
                            fontSize: '0.875rem',
                            lineHeight: '1.5',
                            backgroundColor: '#1e1e1e',
                          }}
                          codeTagProps={{
                            style: {
                              fontSize: 'inherit',
                              fontFamily:
                                "ui-monospace, SFMono-Regular, 'SF Mono', Consolas, 'Liberation Mono', Menlo, monospace",
                            },
                          }}
                        >
                          {codeString}
                        </SyntaxHighlighter>
                      </div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(codeString);
                          setCopiedCode(codeString);
                          setTimeout(() => setCopiedCode(null), 2000);
                        }}
                        className="absolute top-2 right-2 px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded opacity-0 group-hover:opacity-100 transition-all duration-200 flex items-center gap-1"
                        title="コードをコピー"
                      >
                        {copiedCode === codeString ? (
                          <>
                            <Check className="w-3 h-3" />
                            Copied!
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  );
                },
                pre: ({ children }) => <>{children}</>,
                blockquote: ({ children }) => (
                  <blockquote className="border-l-4 border-blue-500 dark:border-blue-400 pl-4 my-3 text-zinc-600 dark:text-zinc-400 italic">
                    {children}
                  </blockquote>
                ),
                table: ({ children }) => (
                  <div className="overflow-x-auto mb-3">
                    <table className="min-w-full divide-y divide-zinc-200 dark:divide-zinc-700">
                      {children}
                    </table>
                  </div>
                ),
                thead: ({ children }) => (
                  <thead className="bg-zinc-100 dark:bg-zinc-800">
                    {children}
                  </thead>
                ),
                tbody: ({ children }) => (
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-700">
                    {children}
                  </tbody>
                ),
                tr: ({ children }) => <tr>{children}</tr>,
                th: ({ children }) => (
                  <th className="px-3 py-2 text-left text-xs font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="px-3 py-2 text-sm text-zinc-700 dark:text-zinc-300">
                    {children}
                  </td>
                ),
                hr: () => (
                  <hr className="my-4 border-zinc-300 dark:border-zinc-600" />
                ),
                a: ({ href, children }) => (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-600 dark:text-blue-400 dark:hover:text-blue-300 underline decoration-1 underline-offset-2"
                  >
                    {children}
                  </a>
                ),
                strong: ({ children }) => (
                  <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                    {children}
                  </strong>
                ),
                em: ({ children }) => <em className="italic">{children}</em>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
        <span
          className={`text-xs mt-2 block ${
            isUser ? 'text-blue-100' : 'text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {message.timestamp.toLocaleTimeString('ja-JP', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
    </div>
  );
}
