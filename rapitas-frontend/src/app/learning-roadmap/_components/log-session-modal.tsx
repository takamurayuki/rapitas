'use client';

/**
 * LogSessionModal
 *
 * Manual study-time entry for the learning roadmap: minutes (quick chips or
 * free input), optional goal attribution, date, and note. Posts to
 * POST /study-sessions; streak/analytics sync happens server-side.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AlarmClockPlus } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import type { StudyGoal } from './roadmap.types';

interface LogSessionModalProps {
  /** Active goals offered for attribution (optional pick). */
  goals: StudyGoal[];
  onClose: () => void;
  /** Called after a successful save so the analytics can refetch. */
  onLogged: () => void;
}

const QUICK_MINUTES = [15, 25, 45, 60];

/** Local yyyy-mm-dd for the date input's default (today). */
const todayKey = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Render the study-time log modal.
 *
 * @param props - Active goals, close and post-save callbacks. / アクティブ目標と保存後コールバック。
 */
export function LogSessionModal({ goals, onClose, onLogged }: LogSessionModalProps) {
  const t = useTranslations('learningRoadmap.logSession');
  const { showToast } = useToast();
  const [minutes, setMinutes] = useState(25);
  const [goalId, setGoalId] = useState<number | null>(
    goals.length === 1 ? (goals[0]?.id ?? null) : null,
  );
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const save = async () => {
    if (minutes < 1 || !date || isSaving) return;
    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/study-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          minutes,
          goalId,
          source: 'manual',
          note: note.trim() || null,
          // Noon local avoids the day flipping across timezones when the
          // backend derives the streak day from this timestamp.
          studiedAt: new Date(`${date}T12:00:00`).toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      showToast(t('saved'), 'success');
      onLogged();
      onClose();
    } catch {
      showToast(t('failed'), 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const inputCls =
    'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus-visible:ring-1 focus-visible:ring-sky-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
  const labelCls = 'text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';
  const chipCls = (selected: boolean) =>
    `whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
      selected
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('title')}
      icon={<AlarmClockPlus className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
      maxWidthClass="max-w-md"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={minutes < 1 || !date || isSaving}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t('save')}
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <span className={labelCls}>{t('minutes')}</span>
          <div className="flex items-center gap-1.5">
            {QUICK_MINUTES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinutes(m)}
                className={chipCls(minutes === m)}
              >
                {t('minutesChip', { min: m })}
              </button>
            ))}
            <input
              type="number"
              min={1}
              max={1440}
              value={minutes}
              onChange={(e) => setMinutes(Math.max(1, Number(e.target.value) || 0))}
              aria-label={t('minutes')}
              className={`${inputCls} w-20`}
            />
          </div>
        </div>

        {goals.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className={labelCls}>{t('goal')}</span>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setGoalId(null)}
                className={chipCls(goalId === null)}
              >
                {t('noGoal')}
              </button>
              {goals.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setGoalId(g.id)}
                  className={`flex items-center gap-1.5 ${chipCls(goalId === g.id)}`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: g.color }}
                    aria-hidden="true"
                  />
                  {g.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t('date')}</span>
            <input
              type="date"
              value={date}
              max={todayKey()}
              onChange={(e) => setDate(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>{t('note')}</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && save()}
              placeholder={t('notePlaceholder')}
              className={inputCls}
            />
          </label>
        </div>
      </div>
    </Modal>
  );
}
