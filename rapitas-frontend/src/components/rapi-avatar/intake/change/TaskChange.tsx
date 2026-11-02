'use client';
/**
 * TaskChange
 *
 * ラピ's "change" mode (#1119 stage 6): a sentence becomes a card naming the
 * task and each change in words; the button on the card is the confirmation,
 * and the same place offers the undo afterwards. Reached by typing — like the
 * roadmap, it has no tab.
 */
import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Pencil, Undo2 } from 'lucide-react';
import { useTaskChange, type TaskChanges } from './use-task-change';

interface Props {
  /** The sentence that was routed here, if any. / ここへ振り分けられた文 */
  handedOver?: string;
}

const FIELDS = ['status', 'priority', 'themeId', 'dueDate'] as const;

/**
 * @param props - The handed-over sentence / 振り分けられた文
 */
export function TaskChange({ handedOver }: Props) {
  const t = useTranslations('rapiAvatar.change');
  const c = useTaskChange();
  const { propose } = c;

  useEffect(() => {
    if (handedOver) void propose(handedOver);
  }, [handedOver, propose]);

  /** One change in words: "状態: 完了". */
  const describe = (field: (typeof FIELDS)[number], value: TaskChanges[typeof field]) => {
    let shown: string;
    if (value === null || value === undefined) shown = t('value.none');
    else if (field === 'status' || field === 'priority') shown = t(`value.${value}` as never);
    else shown = String(value);
    return `${t(`field.${field}` as never)}: ${shown}`;
  };

  return (
    <div className="space-y-3 text-sm" data-testid="rapi-task-change">
      <div className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
        <Pencil className="h-4 w-4" aria-hidden />
        {t('title')}
      </div>

      {!c.proposal && !c.proposing && c.unclear.length === 0 && (
        <p className="text-xs text-slate-500">{t('hint')}</p>
      )}
      {c.proposing && <p className="text-xs text-slate-500">{t('thinking')}</p>}
      {c.error && <p className="text-xs text-red-600">{t('error')}</p>}

      {c.unclear.length > 0 && (
        <div>
          <p className="text-xs text-slate-500">{t('unclear')}</p>
          <ul className="list-disc pl-5 text-xs">
            {c.unclear.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </div>
      )}

      {c.proposal && (
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <p className="text-xs text-slate-500">{t('task')}</p>
          <p className="font-medium">{c.proposal.title}</p>
          <ul className="mt-2 space-y-0.5">
            {FIELDS.filter((f) => f in c.proposal!.changes).map((f) => (
              <li key={f}>{describe(f, c.proposal!.changes[f])}</li>
            ))}
          </ul>
          {c.proposal.reason && <p className="mt-2 text-xs text-slate-500">{c.proposal.reason}</p>}

          {!c.applied && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void c.apply()}
                disabled={c.applying}
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs text-white disabled:opacity-50"
              >
                {c.applying ? t('applying') : t('apply')}
              </button>
              <button
                type="button"
                onClick={c.reset}
                className="rounded-md px-3 py-1.5 text-xs text-slate-600 dark:text-slate-300"
              >
                {t('cancel')}
              </button>
            </div>
          )}

          {c.applied && (
            <div className="mt-3 space-y-1">
              <p className="text-xs text-emerald-700 dark:text-emerald-400">
                {c.undone ? t('undone') : t('applied')}
              </p>
              {!c.undone && (
                <button
                  type="button"
                  onClick={() => void c.undo()}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-600 dark:text-slate-300"
                >
                  <Undo2 className="h-3.5 w-3.5" aria-hidden />
                  {t('undo')}
                </button>
              )}
              {c.conflicts.length > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {t('conflict', {
                    fields: c.conflicts.map((f) => t(`field.${f}` as never)).join('、'),
                  })}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
