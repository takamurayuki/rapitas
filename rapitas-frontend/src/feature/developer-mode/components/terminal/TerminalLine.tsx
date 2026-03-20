'use client';

/**
 * TerminalLine
 *
 * Memoized presentational components for a single terminal output line
 * and the status indicator dot shown in the terminal header.
 */

import { memo } from 'react';
import {
  Loader2,
  AlertCircle,
  CheckCircle2,
  Circle,
  Terminal,
  HelpCircle,
} from 'lucide-react';
import { type LogLine, lineColor } from './terminalUtils';

interface TerminalLineProps {
  line: LogLine;
}

/**
 * Renders one line of terminal output with appropriate color and user-prompt prefix.
 *
 * @param props.line - The log line to render / 表示するログライン
 */
export const TerminalLine = memo(function TerminalLine({
  line,
}: TerminalLineProps) {
  return (
    <div
      className={`px-3 py-0.5 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-all ${lineColor(line.type)}`}
    >
      {line.type === 'user' && (
        <span className="text-green-400 select-none">❯ </span>
      )}
      {line.text}
    </div>
  );
});

interface StatusDotProps {
  status: string;
  waitingForInput?: boolean;
}

/**
 * Renders a small status icon that reflects the current execution state.
 *
 * @param props.status - Execution status string / 実行ステータス文字列
 * @param props.waitingForInput - Whether the agent is waiting for user input / ユーザー入力待ちフラグ
 */
export const StatusDot = memo(function StatusDot({
  status,
  waitingForInput,
}: StatusDotProps) {
  if (waitingForInput)
    return <HelpCircle className="w-3 h-3 text-amber-400 animate-pulse" />;
  switch (status) {
    case 'running':
      return <Loader2 className="w-3 h-3 text-green-400 animate-spin" />;
    case 'completed':
      return <CheckCircle2 className="w-3 h-3 text-green-400" />;
    case 'failed':
      return <AlertCircle className="w-3 h-3 text-red-400" />;
    case 'cancelled':
      return <Circle className="w-3 h-3 text-yellow-400" />;
    default:
      return <Terminal className="w-3 h-3 text-zinc-500" />;
  }
});
