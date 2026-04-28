'use client';

/**
 * TerminalInput
 *
 * Bottom input bar for the terminal panel.
 * Renders the prompt character, textarea, and send/play button.
 */

import { memo, type RefObject } from 'react';
import { Play, Send, Loader2 } from 'lucide-react';

interface TerminalInputProps {
  /** Forwarded ref used by the parent to focus the input. */
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  /** Whether a request is currently in-flight (disables input). */
  submitting: boolean;
  /** Whether execution is active (disables free-text input, allows answer input). */
  isRunning: boolean;
  /** Whether the agent is waiting for user input. */
  isWaiting: boolean;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: () => void;
}

/**
 * Renders the terminal input row with a prompt prefix and an adaptive send button.
 *
 * @param props - TerminalInputProps
 */
export const TerminalInput = memo(function TerminalInput({
  inputRef,
  value,
  submitting,
  isRunning,
  isWaiting,
  onChange,
  onKeyDown,
  onSubmit,
}: TerminalInputProps) {
  const placeholder = isWaiting
    ? '回答を入力...'
    : isRunning
      ? '実行中...'
      : '指示を入力... (Enter で送信)';

  return (
    <div className="flex items-end gap-2 px-3 py-2 bg-zinc-800/50 border-t border-zinc-700">
      <span className="text-green-400 text-[11px] font-mono pt-1.5 select-none">❯</span>
      <textarea
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={submitting || (isRunning && !isWaiting)}
        rows={1}
        className="flex-1 bg-transparent text-[11px] text-zinc-200 font-mono placeholder:text-zinc-600 outline-none resize-none disabled:opacity-40"
        style={{ minHeight: '24px', maxHeight: '96px' }}
      />
      <button
        onClick={onSubmit}
        disabled={!value.trim() || submitting || (isRunning && !isWaiting)}
        className="p-1.5 text-zinc-400 hover:text-violet-400 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
        title={isWaiting ? '回答を送信' : '実行'}
      >
        {submitting ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : isWaiting ? (
          <Send className="w-3.5 h-3.5" />
        ) : (
          <Play className="w-3.5 h-3.5" />
        )}
      </button>
    </div>
  );
});
