'use client';
// ContinuationForm

import { Loader2, Play, MessageSquarePlus } from 'lucide-react';

export type ContinuationFormProps = {
  /** Current text of the follow-up instruction field. */
  continueInstruction: string;
  /** Called on every keystroke in the textarea. */
  onSetContinueInstruction: (v: string) => void;
  /** Triggered when the user submits the continuation. */
  onContinueExecution: () => Promise<void>;
  /** True while the parent is awaiting the new execution response. */
  isExecuting: boolean;
};

/**
 * Continuation execution form rendered below completed execution logs.
 *
 * @param props.continueInstruction - Controlled textarea value.
 * @param props.onContinueExecution - Starts a new execution with the prior output as context.
 */
export function ContinuationForm({
  continueInstruction,
  onSetContinueInstruction,
  onContinueExecution,
  isExecuting,
}: ContinuationFormProps) {
  return (
    <div className="p-3 bg-linear-to-br from-indigo-50 via-violet-50 to-purple-50 dark:from-indigo-900/20 dark:via-violet-900/20 dark:to-purple-900/20 rounded-lg border border-indigo-200 dark:border-indigo-800/50 space-y-2">
      <div className="flex items-center gap-2">
        <div className="p-1 bg-indigo-100 dark:bg-indigo-900/40 rounded">
          <MessageSquarePlus className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h4 className="text-xs font-semibold text-indigo-900 dark:text-indigo-100">
            継続実行
          </h4>
          <p className="text-[10px] text-indigo-700 dark:text-indigo-300">
            前回の実行結果を踏まえて、追加の指示を与えることができます
          </p>
        </div>
      </div>
      <div className="flex gap-2">
        <textarea
          value={continueInstruction}
          onChange={(e) => onSetContinueInstruction(e.target.value)}
          placeholder="例: エラーを修正してください / テストを追加してください / リファクタリングしてください"
          rows={3}
          className="flex-1 px-3 py-2 bg-white dark:bg-zinc-800 border border-indigo-200 dark:border-indigo-700 rounded-lg text-xs resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          aria-label="継続実行の内容"
        />
        <div className="flex flex-col gap-1.5">
          <button
            onClick={onContinueExecution}
            disabled={!continueInstruction.trim() || isExecuting}
            className="flex items-center gap-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow-md"
            aria-label="継続実行"
          >
            {isExecuting ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Play className="w-3 h-3" />
            )}
            継続実行
          </button>
        </div>
      </div>
    </div>
  );
}
