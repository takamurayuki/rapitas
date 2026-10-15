/**
 * TodayTaskProgressBarCompact
 *
 * Compact-mode render of TodayTaskProgressBar (thermometer bar + hover
 * popover of remaining due-today tasks). Extracted from
 * TodayTaskProgressBar.tsx to keep that file under the size limit; markup
 * and behavior are unchanged.
 */
'use client';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface DueTodayTask {
  id: number;
  title: string;
  status: string;
}

export interface TodayTaskProgressBarCompactProps {
  className: string;
  isLoading: boolean;
  totalCount: number;
  efficiency: number;
  tasks: DueTodayTask[] | undefined;
  isCelebrating: boolean;
  isHovered: boolean;
  setIsHovered: (hovered: boolean) => void;
}

/** Compact thermometer-bar render of the due-today progress widget. */
export default function TodayTaskProgressBarCompact({
  className,
  isLoading,
  totalCount,
  efficiency,
  tasks,
  isCelebrating,
  isHovered,
  setIsHovered,
}: TodayTaskProgressBarCompactProps) {
  const t = useTranslations('home');

  const isDone = efficiency === 100;
  // NOTE: done state uses GREEN — the app-wide completion hue (was emerald,
  // which split the "完了" meaning against the green used by task done /
  // completed states everywhere else).
  const fillColor = isDone
    ? 'bg-gradient-to-r from-green-500 to-green-400'
    : 'bg-gradient-to-r from-blue-500 to-blue-400';
  const circleColor = isDone ? '#22c55e' : '#3b82f6';
  const pctColor = isDone
    ? 'text-green-600 dark:text-green-400'
    : 'text-zinc-500 dark:text-zinc-400';

  const remaining = (tasks ?? []).filter((tk) => tk.status !== 'done');
  const popoverTasks = remaining.slice(0, 6);
  const extraCount = remaining.length - popoverTasks.length;

  // ── 本日期限のタスクがない場合: 無効表示 ──────────────────────────────
  if (!isLoading && totalCount === 0) {
    return (
      <div className={`relative ${className}`}>
        {/* NOTE: rounded-lg + no shadow + zinc hues — matches the task cards and
            toolbar controls; the old rounded-xl slate card with shadow-sm floated
            against its flat neighbours. */}
        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 dark:border-zinc-800 dark:bg-indigo-dark-900">
          <p className="mb-1.5 text-[12px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
            {t('noDueTodayTasks')}
          </p>
          <div className="relative h-4 rounded-full border-2 border-zinc-200 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* ── Card ─────────────────────────────────────────────────────────── */}
      {/* NOTE: rounded-lg + no shadow + zinc hues — matches the task cards and
          toolbar controls; the old rounded-xl slate card with shadow-sm floated
          against its flat neighbours. */}
      <div className="rounded-lg border border-zinc-200 bg-white px-3 py-2.5 transition-all duration-500 dark:border-zinc-800 dark:bg-indigo-dark-900">
        {/* Top row: label left, percentage right */}
        <div className="mb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1">
            <AnimatePresence>
              {isDone && (
                <motion.span
                  className="relative inline-flex items-center justify-center"
                  initial={{ scale: 0, rotate: -30, opacity: 0 }}
                  animate={{ scale: 1, rotate: 0, opacity: 1 }}
                  exit={{ scale: 0, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                >
                  {/* Green glow ring — expands outward on completion */}
                  <AnimatePresence>
                    {isCelebrating && (
                      <motion.span
                        className="pointer-events-none absolute rounded-full border-2 border-green-400"
                        style={{ inset: -3 }}
                        initial={{ scale: 1, opacity: 0.9 }}
                        animate={{ scale: 5, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.6, ease: 'easeOut' }}
                      />
                    )}
                  </AnimatePresence>
                  {/* Ray burst — 8 green-family lines radiating outward like sunbeams */}
                  <AnimatePresence>
                    {isCelebrating &&
                      [
                        '#22c55e',
                        '#4ade80',
                        '#16a34a',
                        '#86efac',
                        '#15803d',
                        '#4ade80',
                        '#22c55e',
                        '#bbf7d0',
                      ].map((color, i, arr) => {
                        const angle = (i / arr.length) * Math.PI * 2;
                        const deg = (i / arr.length) * 360;
                        return (
                          <motion.span
                            key={i}
                            className="pointer-events-none absolute"
                            style={{
                              width: 9,
                              height: 2,
                              backgroundColor: color,
                              borderRadius: 1,
                              top: 'calc(50% - 1px)',
                              left: '50%',
                              rotate: `${deg}deg`,
                            }}
                            initial={{ x: 0, y: 0, opacity: 1 }}
                            animate={{
                              x: Math.cos(angle) * 26,
                              y: Math.sin(angle) * 26,
                              opacity: 0,
                            }}
                            transition={{ duration: 0.6, ease: 'easeOut', delay: i * 0.025 }}
                          />
                        );
                      })}
                  </AnimatePresence>
                  <CheckCheck size={14} className="relative text-green-500" />
                </motion.span>
              )}
            </AnimatePresence>
            <p className="text-[12px] font-semibold tracking-wide text-zinc-500 dark:text-zinc-400">
              {t('todayDueTask')}
            </p>
          </div>
          <AnimatePresence mode="wait">
            <motion.span
              key={efficiency}
              initial={{ y: -4, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 4, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={`text-xs font-bold tabular-nums transition-colors duration-500 ${pctColor}`}
            >
              {`${efficiency}%`}
            </motion.span>
          </AnimatePresence>
        </div>

        {/* Full-width thermometer bar */}
        <div className="relative h-4 overflow-visible rounded-full border-2 border-zinc-200 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800">
          {efficiency > 0 && (
            <motion.div
              className={`absolute bottom-[2px] left-[2px] top-[2px] rounded-full transition-colors duration-500 ${fillColor}`}
              animate={{ width: `max(0px, calc(${efficiency}% - 4px))` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
          )}
          {/* Tick dividers — 8 equal sections (7 lines at 12.5% increments).
              12.5% keeps lines well past the rounded-full curve radius so
              they all render at the same full height without being clipped. */}
          {[12.5, 25, 37.5, 50, 62.5, 75, 87.5].map((pct) => (
            <div
              key={pct}
              className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-zinc-200 dark:bg-zinc-600"
              style={{ left: `${pct}%` }}
            />
          ))}
          {efficiency > 0 && (
            <motion.div
              className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-md"
              style={{ backgroundColor: circleColor, transition: 'background-color 0.5s' }}
              animate={{ left: `${Math.min(efficiency, 100)}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            />
          )}
        </div>
      </div>

      {/* ── Hover popover: remaining tasks ───────────────────────────────── */}
      <AnimatePresence>
        {isHovered && tasks && tasks.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[200px] overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-indigo-dark-900"
          >
            {remaining.length === 0 ? (
              <div className="flex items-center gap-2 px-3 py-2.5">
                <Trophy size={13} className="shrink-0 text-amber-500" />
                <span className="text-xs font-semibold text-green-600 dark:text-green-400">
                  {t('allDueTodayDone')}
                </span>
              </div>
            ) : (
              <>
                <div className="border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
                  <span className="text-[11px] font-semibold text-zinc-500 dark:text-zinc-400">
                    {t('todayTaskProgress.remainingCount', { count: remaining.length })}
                  </span>
                </div>
                <ul className="py-1">
                  {popoverTasks.map((tk) => (
                    <li key={tk.id}>
                      <Link
                        href={`/tasks/${tk.id}`}
                        onClick={() => setIsHovered(false)}
                        className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/60 transition-colors"
                      >
                        <span
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            tk.status === 'in-progress'
                              ? 'bg-blue-400'
                              : 'bg-zinc-200 dark:bg-zinc-600'
                          }`}
                        />
                        <span className="min-w-0 truncate text-xs text-zinc-700 dark:text-zinc-200">
                          {tk.title}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {extraCount > 0 && (
                  <div className="border-t border-zinc-100 px-3 py-1.5 dark:border-zinc-800">
                    <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                      {t('todayTaskProgress.moreCount', { count: extraCount })}
                    </span>
                  </div>
                )}
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
