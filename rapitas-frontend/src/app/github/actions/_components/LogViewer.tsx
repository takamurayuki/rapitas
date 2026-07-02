'use client';

/**
 * LogViewer
 *
 * Scrollable log panel with a copy-to-clipboard icon in the top-right corner.
 * Used to display a single step's log section.
 */

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface LogViewerProps {
  /** Log text to display and copy. / 表示・コピー対象のログ */
  log: string;
}

/**
 * Render a log panel with a top-right copy button.
 *
 * @param props - The log text / ログ文字列
 */
export function LogViewer({ log }: LogViewerProps) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(log);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (e.g. insecure context) — silently ignore */
    }
  };

  return (
    <div className="relative">
      <button
        onClick={onCopy}
        title="ログをコピー"
        aria-label="ログをコピー"
        className="absolute right-2 top-2 z-10 rounded p-1 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100"
      >
        {copied ? (
          <Check className="h-3.5 w-3.5 text-green-400" />
        ) : (
          <Copy className="h-3.5 w-3.5" />
        )}
      </button>
      <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded bg-zinc-900 p-3 pr-9 text-[11px] leading-relaxed text-zinc-100">
        {log}
      </pre>
    </div>
  );
}
