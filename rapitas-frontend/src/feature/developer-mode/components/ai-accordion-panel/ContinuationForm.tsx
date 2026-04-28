'use client';
// ContinuationForm — inline follow-up execution input, shown only when completed.
import { Loader2, Play, MessageSquarePlus } from 'lucide-react';

export type ContinuationFormProps = {
  continueInstruction: string;
  onSetContinueInstruction: (v: string) => void;
  onContinueExecution: () => Promise<void>;
  isExecuting: boolean;
};

/**
 * Inline continuation form rendered below completed execution logs.
 * Always visible (no toggle) — compact enough to stay open.
 *
 * @param props.continueInstruction - Controlled input value.
 * @param props.onContinueExecution - Starts a new execution with prior output as context.
 */
export function ContinuationForm({
  continueInstruction,
  onSetContinueInstruction,
  onContinueExecution,
  isExecuting,
}: ContinuationFormProps) {
  return (
    <div className="flex items-center gap-1.5 px-1 py-1">
      <MessageSquarePlus className="w-3 h-3 text-indigo-500 shrink-0" />
      <input
        type="text"
        value={continueInstruction}
        onChange={(e) => onSetContinueInstruction(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && continueInstruction.trim()) onContinueExecution();
        }}
        placeholder="継続指示を入力..."
        className="flex-1 px-2.5 py-1.5 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
        aria-label="継続実行の内容"
      />
      <button
        onClick={onContinueExecution}
        disabled={!continueInstruction.trim() || isExecuting}
        className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-medium rounded transition-colors disabled:opacity-50 shrink-0"
        aria-label="継続実行"
      >
        {isExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3" />}
        実行
      </button>
    </div>
  );
}
