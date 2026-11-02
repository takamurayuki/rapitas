'use client';
/**
 * TaskCleanup
 *
 * Asking ラピ to clear away tasks you no longer want.
 *
 * Two steps, like filing one: describing what to remove produces a list with
 * a reason beside each task, and nothing is deleted until the button is
 * pressed. What goes is what is still ticked — never what was proposed.
 *
 * Every removal offers 元に戻す, because the trash makes that possible; the
 * capability would not exist otherwise.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trash2, Undo2 } from 'lucide-react';
import { isImeComposing } from '@/utils/ime';
import { useDeleteProposal } from './use-delete-proposal';

export function TaskCleanup() {
  const t = useTranslations('rapiAvatar.cleanup');
  const [text, setText] = useState('');
  const {
    candidates,
    chosen,
    considered,
    unclear,
    available,
    proposing,
    removing,
    error,
    results,
    undoable,
    propose,
    toggle,
    remove,
    undo,
    reset,
  } = useDeleteProposal();

  const deleted = results?.filter((r) => r.outcome === 'deleted') ?? [];
  const refused = results?.filter((r) => r.outcome !== 'deleted') ?? [];

  return (
    <section className="space-y-2 p-2">
      <h3 className="text-xs font-semibold text-zinc-700 dark:text-zinc-200">{t('title')}</h3>

      {candidates.length === 0 && !results && (
        <>
          <textarea
            rows={2}
            value={text}
            placeholder={t('placeholder')}
            aria-label={t('title')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !isImeComposing(e.nativeEvent)) {
                e.preventDefault();
                void propose(text);
              }
            }}
            className="w-full resize-none rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <button
            type="button"
            onClick={() => void propose(text)}
            disabled={!text.trim() || proposing}
            className="w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {proposing ? t('looking') : t('propose')}
          </button>
          {!available && !proposing && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">{t('unavailable')}</p>
          )}
        </>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-800/50">
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
            {t('weighed', { considered })}
          </p>

          <ul className="space-y-1.5">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={chosen.has(c.id)}
                  onChange={() => toggle(c.id)}
                  aria-label={c.title}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span className="min-w-0">
                  <span className="block truncate text-xs text-zinc-800 dark:text-zinc-100">
                    {c.title}
                  </span>
                  {c.reason && <span className="block text-[10px] text-zinc-400">{c.reason}</span>}
                </span>
              </li>
            ))}
          </ul>

          {unclear.length > 0 && (
            <ul className="list-inside list-disc">
              {unclear.map((u) => (
                <li key={u} className="text-[10px] text-amber-700 dark:text-amber-400">
                  {u}
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={chosen.size === 0 || removing}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {removing ? t('removing') : t('remove', { count: chosen.size })}
            </button>
            <button
              type="button"
              onClick={() => {
                reset();
                setText('');
              }}
              className="rounded-lg px-3 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="space-y-1.5 rounded-lg border border-zinc-200 p-2 dark:border-zinc-700">
          <p className="text-[11px] text-zinc-700 dark:text-zinc-200">
            {t('removed', { count: deleted.length })}
          </p>
          {refused.length > 0 && (
            <p className="text-[10px] text-amber-700 dark:text-amber-400">
              {t('keptBack', { count: refused.length })}
            </p>
          )}
          {undoable.length > 0 && (
            <button
              type="button"
              onClick={() => void undo()}
              disabled={removing}
              className="flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1 text-xs text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
            >
              <Undo2 className="h-3.5 w-3.5" />
              {t('undo')}
            </button>
          )}
        </div>
      )}

      {error && <p className="text-[11px] text-red-600 dark:text-red-400">{t('error')}</p>}
    </section>
  );
}
