'use client';
/**
 * ContinuationForm
 *
 * Where you tell a finished agent what to do next, carrying the previous
 * output forward as context. Shown only once an execution has completed.
 *
 * Kept rather than removed (asked 2026-10-23) because nothing else does this
 * job: starting again from the idle form begins a fresh run with no memory of
 * what just happened, so without this box a follow-up loses the context that
 * makes it a follow-up.
 *
 * It was a one-line `<input>`, which is the wrong shape for its content — a
 * sentence or three of natural language, of which you could see about eight
 * characters. A textarea that grows with the text replaces it, and that moves
 * the keyboard contract: Enter belongs to the text now, and running is
 * Cmd/Ctrl+Enter. The button it used to press starts a real, billable agent
 * execution, so a stray Enter launching one is a mistake worth designing out.
 */
import { useId } from 'react';
import { Loader2, Play, MessageSquarePlus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { isImeComposing } from '@/utils/ime';
// Shared with idle-execution-form: the two instruction boxes in this panel
// should grow the same way, or the panel reads as two different controls.
import { instructionRows } from '@/utils/textarea-rows';

export type ContinuationFormProps = {
  continueInstruction: string;
  onSetContinueInstruction: (v: string) => void;
  onContinueExecution: () => Promise<void>;
  isExecuting: boolean;
};

/**
 * Inline continuation form rendered below completed execution logs.
 *
 * @param props.continueInstruction - Controlled textarea value. / 入力値
 * @param props.onContinueExecution - Starts a new execution with prior output as context. / 直前の出力を文脈として続きを実行
 */
export function ContinuationForm({
  continueInstruction,
  onSetContinueInstruction,
  onContinueExecution,
  isExecuting,
}: ContinuationFormProps) {
  const t = useTranslations('devMode.continuationForm');
  const fieldId = useId();
  const canRun = !!continueInstruction.trim() && !isExecuting;

  return (
    <div className="space-y-1 px-1 py-1">
      <label
        htmlFor={fieldId}
        className="flex items-center gap-1.5 text-[10px] text-zinc-500 dark:text-zinc-400"
      >
        <MessageSquarePlus className="h-3 w-3 shrink-0 text-indigo-500" />
        {t('label')}
      </label>

      <textarea
        id={fieldId}
        value={continueInstruction}
        rows={instructionRows(continueInstruction)}
        onChange={(e) => onSetContinueInstruction(e.target.value)}
        onKeyDown={(e) => {
          // Enter is a newline here. Only the modified Enter runs, and never
          // while an IME is composing — that Enter is confirming a Japanese
          // conversion, and submitting it would run on half-converted text.
          if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
          if (isImeComposing(e) || !canRun) return;
          e.preventDefault();
          void onContinueExecution();
        }}
        placeholder={t('placeholder')}
        className="w-full resize-y rounded border border-zinc-200 bg-white px-2.5 py-1.5 text-xs leading-relaxed focus:border-indigo-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800"
        aria-label={t('inputAria')}
      />

      <div className="flex items-center gap-2">
        <button
          onClick={() => void onContinueExecution()}
          disabled={!canRun}
          className="flex shrink-0 items-center gap-1 rounded bg-indigo-600 px-3 py-1.5 text-[11px] font-medium text-white transition-colors hover:bg-indigo-700 disabled:opacity-50"
          aria-label={t('runAria')}
        >
          {isExecuting ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {t('run')}
        </button>
        {/* The shortcut replaced the Enter people had already learned, so it
            has to be said rather than discovered. */}
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{t('submitHint')}</span>
      </div>
    </div>
  );
}
