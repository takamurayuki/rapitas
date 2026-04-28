'use client';

/**
 * TerminalOutput
 *
 * Scrollable output area for the terminal panel.
 * Renders log lines and a blinking cursor while the agent is running.
 */

import { memo, type RefObject } from 'react';
import { Terminal } from 'lucide-react';
import { TerminalLine } from './TerminalLine';
import type { LogLine } from './terminal-utils';

interface TerminalOutputProps {
  /** Forwarded ref used by the parent for auto-scroll. */
  outputRef: RefObject<HTMLDivElement | null>;
  lines: LogLine[];
  /** Whether execution is active (controls blinking cursor). */
  isRunning: boolean;
  /** Whether the agent is waiting for user input. */
  isWaiting: boolean;
}

/**
 * Renders the scrollable log output area with an empty-state placeholder.
 *
 * @param props - TerminalOutputProps
 */
export const TerminalOutput = memo(function TerminalOutput({
  outputRef,
  lines,
  isRunning,
  isWaiting,
}: TerminalOutputProps) {
  return (
    <div
      ref={outputRef}
      className="flex-1 overflow-y-auto min-h-[200px] max-h-[500px] py-2 font-mono"
    >
      {lines.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-zinc-600 gap-2">
          <Terminal className="w-6 h-6" />
          <span className="text-[10px]">指示を入力してAIエージェントを実行</span>
        </div>
      ) : (
        lines.map((line) => <TerminalLine key={line.id} line={line} />)
      )}

      {/* Blinking cursor shown only while running and not waiting for input. */}
      {isRunning && !isWaiting && (
        <div className="px-3 py-1">
          <span className="inline-block w-2 h-4 bg-green-400 animate-pulse" />
        </div>
      )}
    </div>
  );
});
