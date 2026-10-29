'use client';
/**
 * TaskTidy
 *
 * Clearing tasks away — the two ways of doing it, under one tab.
 *
 * They were two tabs, "AIで選ぶ" and "条件で選ぶ", which spent a quarter of the
 * tab bar on one job described twice. They are the same job: deciding what
 * goes. Only the instrument differs.
 *
 * Conditions are the default, and that is a measurement rather than a
 * preference. The judgement-based picker can only weigh a window of sixty
 * tasks; on the rapitas theme — 719 tasks — that is not a worse answer, it
 * is the wrong instrument, because it cannot see most of what it is being
 * asked about.
 *
 * Draws the choice and nothing else; both halves are their own components.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TaskBulkCleanup } from './TaskBulkCleanup';
import { TaskCleanup } from './TaskCleanup';

/** How the tasks to remove are chosen. */
type Instrument = 'condition' | 'judgement';

export function TaskTidy() {
  const t = useTranslations('rapiAvatar.tidy');
  const [how, setHow] = useState<Instrument>('condition');

  const chip = (value: Instrument, label: string) => (
    <button
      key={value}
      type="button"
      onClick={() => setHow(value)}
      aria-pressed={how === value}
      className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
        how === value
          ? 'bg-zinc-700 text-white dark:bg-zinc-200 dark:text-zinc-900'
          : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="flex items-center gap-1 px-2 pt-2">
        {chip('condition', t('byCondition'))}
        {chip('judgement', t('byJudgement'))}
      </div>
      {/* What each instrument actually does, because "by condition" and
          "let me pick" do not say it on their own. */}
      <p className="px-2 pt-1 text-[10px] text-zinc-400">
        {how === 'condition' ? t('conditionHint') : t('judgementHint')}
      </p>

      {how === 'condition' ? <TaskBulkCleanup /> : <TaskCleanup />}
    </div>
  );
}
