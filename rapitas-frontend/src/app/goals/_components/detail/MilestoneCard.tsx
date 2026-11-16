'use client';
/**
 * MilestoneCard
 *
 * One milestone (節目) of a goal: its 達成条件, how many of its tasks are
 * done, and — once confirmed — the person's evidence. Task counts are shown
 * for orientation only; "reached" comes from the confirmation, never from them.
 */
import { useState } from 'react';
import {
  CirclePause,
  Medal,
  Milestone as MilestoneIcon,
  Pencil,
  Play,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Milestone } from '../../_hooks/goals.types';
import { MilestoneCriteriaEditor } from './MilestoneCriteriaEditor';

/** Actions the card can trigger; each resolves to an error sentence or null. */
export interface MilestoneActions {
  saveCriteria: (id: number, criteria: string[]) => Promise<string | null>;
  setPaused: (id: number, paused: boolean) => Promise<string | null>;
  reopen: (id: number) => Promise<string | null>;
  remove: (id: number) => Promise<void>;
  openConfirm: (milestone: Milestone) => void;
}

const STATUS_STYLE: Record<Milestone['status'], string> = {
  open: 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300',
  reached: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  paused: 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
};

const iconButton =
  'flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800';

/**
 * Renders a milestone card.
 *
 * @param milestone - The milestone / 節目
 * @param actions - Card actions / 節目への操作
 */
export function MilestoneCard({
  milestone,
  actions,
}: {
  milestone: Milestone;
  actions: MilestoneActions;
}) {
  const t = useTranslations('goals');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reached = milestone.status === 'reached';
  const paused = milestone.status === 'paused';

  const act = async (action: () => Promise<string | null>) => setError(await action());

  return (
    <li
      className={`rounded-xl border bg-white p-4 dark:bg-indigo-dark-900 ${
        reached
          ? 'border-amber-300 dark:border-amber-700/60'
          : 'border-zinc-200 dark:border-zinc-800'
      } ${paused ? 'opacity-70' : ''}`}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {reached ? (
          <Medal className="h-4 w-4 text-amber-500" />
        ) : (
          <MilestoneIcon className="h-4 w-4 text-zinc-400" />
        )}
        <h3 className="font-medium text-zinc-900 dark:text-zinc-50">{milestone.name}</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[milestone.status]}`}>
          {t(`status.${milestone.status}`)}
        </span>
        {milestone.dueDate && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            {t('due', { date: new Date(milestone.dueDate).toLocaleDateString() })}
          </span>
        )}
        <span className="ml-auto text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
          {t('taskCount', { done: milestone.taskDone, total: milestone.taskTotal })}
        </span>
      </div>

      <div className="mb-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
            {t('criteria.title')}
          </span>
          {!reached && !editing && (
            <button type="button" onClick={() => setEditing(true)} className={iconButton}>
              <Pencil className="h-3.5 w-3.5" />
              {t('criteria.edit')}
            </button>
          )}
        </div>
        {editing ? (
          <MilestoneCriteriaEditor
            initial={milestone.acceptanceCriteria}
            onCancel={() => setEditing(false)}
            onSave={async (criteria) => {
              const failure = await actions.saveCriteria(milestone.id, criteria);
              if (!failure) setEditing(false);
              return failure;
            }}
          />
        ) : milestone.acceptanceCriteria.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('criteria.none')}</p>
        ) : (
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-200">
            {milestone.acceptanceCriteria.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
      </div>

      {reached && milestone.evidence && (
        <div className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-900/10">
          <div className="mb-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            {t('evidence', {
              date: milestone.reachedAt ? new Date(milestone.reachedAt).toLocaleDateString() : '',
            })}
          </div>
          <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-200">
            {milestone.evidence}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1">
        {milestone.status === 'open' && (
          <button
            type="button"
            onClick={() => actions.openConfirm(milestone)}
            disabled={milestone.acceptanceCriteria.length === 0}
            title={
              milestone.acceptanceCriteria.length === 0 ? t('confirm.needsCriteria') : undefined
            }
            className="flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Medal className="h-3.5 w-3.5" />
            {t('confirm.open')}
          </button>
        )}
        {reached && (
          <button
            type="button"
            onClick={() => act(() => actions.reopen(milestone.id))}
            className={iconButton}
          >
            <Undo2 className="h-3.5 w-3.5" />
            {t('reopen')}
          </button>
        )}
        {!reached && (
          <button
            type="button"
            onClick={() => act(() => actions.setPaused(milestone.id, !paused))}
            className={iconButton}
          >
            {paused ? <Play className="h-3.5 w-3.5" /> : <CirclePause className="h-3.5 w-3.5" />}
            {paused ? t('resume') : t('pause')}
          </button>
        )}
        <button
          type="button"
          onClick={() => actions.remove(milestone.id)}
          className={`${iconButton} ml-auto text-red-600 dark:text-red-400`}
          aria-label={t('delete')}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}
