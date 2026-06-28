'use client';
import React, { memo, useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Activity, Award, Zap, Trophy, CheckCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useDueTodayTasks } from '@/hooks/ui/useDueTodayTasks';

const PROGRESS_MESSAGES = [
  'Surprisingly adequate.',
  'Is that all?',
  "Don't get used to it.",
  'Efficiency: Acceptable.',
  'Human error minimized.',
  'Fabulous effort, I guess.',
  'One less failure.',
  'Absolute perfection. Finally.',
];

const GoldParticle = ({
  x,
  y,
  angle,
  distance,
}: {
  x: number;
  y: number;
  angle: number;
  distance: number;
}) => {
  return (
    <motion.div
      initial={{ x: 0, y: 0, scale: 0, rotate: 0 }}
      animate={{
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        scale: [0, 1.5, 0],
        rotate: 360,
      }}
      transition={{ duration: 1, ease: 'easeOut' }}
      className="pointer-events-none absolute z-50 text-amber-400"
      style={{ left: x, top: y }}
    >
      <Zap size={10} fill="currentColor" />
    </motion.div>
  );
};

const CynicalPopup = ({ x, y, msg }: { x: number; y: number; msg: string }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 0, x: -20 }}
      animate={{ opacity: 1, y: -50, x: 20 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none absolute z-50 whitespace-nowrap border border-amber-500/50 bg-white/90 dark:bg-black/80 px-2 py-1 font-mono text-[10px] uppercase tracking-tighter text-amber-600 dark:text-amber-200"
      style={{ left: x, top: y }}
    >
      {`> ${msg}`}
    </motion.div>
  );
};

interface TodayTaskProgressBarProps {
  /** Used in non-compact mode only. Compact mode self-fetches via useDueTodayTasks. */
  completedCount?: number;
  /** Used in non-compact mode only. */
  totalCount?: number;
  className?: string;
  compact?: boolean;
  /** Used in non-compact mode only. */
  tasks?: Array<{ id: number; title: string; status: string }>;
}

const TodayTaskProgressBar = memo<TodayTaskProgressBarProps>(
  ({
    completedCount: propCompleted = 0,
    totalCount: propTotal = 0,
    className = '',
    compact = false,
    tasks: propTasks,
  }) => {
    // Compact mode self-fetches tasks due today; non-compact uses props.
    const dueTodayResult = useDueTodayTasks();
    const completedCount = compact ? dueTodayResult.completedCount : propCompleted;
    const totalCount = compact ? dueTodayResult.totalCount : propTotal;
    const tasks = compact ? dueTodayResult.tasks : propTasks;

    const previousCompletedRef = useRef(completedCount);
    const [showEffects, setShowEffects] = useState(false);
    const [systemCritical, setSystemCritical] = useState(false);

    const progress = totalCount > 0 ? completedCount / totalCount : 0;
    const efficiency = Math.floor(progress * 100);

    useEffect(() => {
      if (completedCount > previousCompletedRef.current) {
        // Use setTimeout with 0 delay to move setState out of synchronous effect execution
        const showTimer = setTimeout(() => setShowEffects(true), 0);
        const hideTimer = setTimeout(() => setShowEffects(false), 1200);
        previousCompletedRef.current = completedCount;
        return () => {
          clearTimeout(showTimer);
          clearTimeout(hideTimer);
        };
      }
      previousCompletedRef.current = completedCount;
    }, [completedCount]);

    useEffect(() => {
      if (efficiency === 100 && totalCount > 0) {
        // Use setTimeout with 0 delay to move setState out of synchronous effect execution
        const showTimer = setTimeout(() => setSystemCritical(true), 0);
        const hideTimer = setTimeout(() => setSystemCritical(false), 4000);
        return () => {
          clearTimeout(showTimer);
          clearTimeout(hideTimer);
        };
      }
    }, [efficiency, totalCount]);

    // ── Compact-mode: celebration burst + hover popover ───────────────────────
    // wasDoneRef tracks whether we were already at 100% to detect the rising edge.
    const wasDoneRef = useRef(efficiency === 100);
    const [isCelebrating, setIsCelebrating] = useState(false);
    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
      const isDoneNow = efficiency === 100 && totalCount > 0;
      if (isDoneNow && !wasDoneRef.current) {
        const t = setTimeout(() => setIsCelebrating(true), 0);
        const u = setTimeout(() => setIsCelebrating(false), 2200);
        wasDoneRef.current = true;
        return () => {
          clearTimeout(t);
          clearTimeout(u);
        };
      }
      if (!isDoneNow) wasDoneRef.current = false;
    }, [efficiency, totalCount]);

    // Pre-generate random values using useState with lazy initialization (only runs once on mount)
    const [particleData] = useState(() =>
      Array.from({ length: 8 }, () => ({
        angle: Math.random() * Math.PI * 2,
        distance: 30 + Math.random() * 50,
      })),
    );

    const [popupMsg] = useState(
      () => PROGRESS_MESSAGES[Math.floor(Math.random() * PROGRESS_MESSAGES.length)],
    );

    const [rainEffectData] = useState(() =>
      Array.from({ length: 20 }, () => ({
        x: (Math.random() - 0.5) * 800,
        text: Math.random() > 0.5 ? '1010101' : 'TASK_COMPLETE',
      })),
    );

    const t = useTranslations('home');

    if (compact) {
      const isDone = efficiency === 100;
      const fillColor = isDone
        ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
        : 'bg-gradient-to-r from-blue-500 to-blue-400';
      const circleColor = isDone ? '#10b981' : '#3b82f6';
      const pctColor = isDone
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-slate-500 dark:text-zinc-400';

      const remaining = (tasks ?? []).filter((tk) => tk.status !== 'done');
      const popoverTasks = remaining.slice(0, 6);
      const extraCount = remaining.length - popoverTasks.length;

      // ── 本日期限のタスクがない場合: 無効表示 ──────────────────────────────
      if (!dueTodayResult.isLoading && totalCount === 0) {
        return (
          <div className={`relative ${className}`}>
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm dark:border-zinc-800 dark:bg-indigo-dark-900">
              <p className="mb-1.5 text-[12px] font-semibold tracking-wide text-slate-400 dark:text-zinc-500">
                {t('noDueTodayTasks')}
              </p>
              <div className="relative h-4 rounded-full border-2 border-slate-200 bg-slate-100 dark:border-zinc-600 dark:bg-zinc-800" />
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
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm transition-all duration-500 dark:border-zinc-800 dark:bg-indigo-dark-900">
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
                      {/* Emerald glow ring — expands outward on completion */}
                      <AnimatePresence>
                        {isCelebrating && (
                          <motion.span
                            className="pointer-events-none absolute rounded-full border-2 border-emerald-400"
                            style={{ inset: -3 }}
                            initial={{ scale: 1, opacity: 0.9 }}
                            animate={{ scale: 5, opacity: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.6, ease: 'easeOut' }}
                          />
                        )}
                      </AnimatePresence>
                      {/* Ray burst — 8 emerald/teal lines radiating outward like sunbeams */}
                      <AnimatePresence>
                        {isCelebrating &&
                          [
                            '#10b981',
                            '#34d399',
                            '#059669',
                            '#6ee7b7',
                            '#14b8a6',
                            '#2dd4bf',
                            '#0d9488',
                            '#5eead4',
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
                      <CheckCheck size={14} className="relative text-emerald-500" />
                    </motion.span>
                  )}
                </AnimatePresence>
                <p className="text-[12px] font-semibold tracking-wide text-slate-400 dark:text-zinc-500">
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
            <div className="relative h-4 overflow-visible rounded-full border-2 border-slate-200 bg-slate-100 dark:border-zinc-600 dark:bg-zinc-800">
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
                  className="pointer-events-none absolute inset-y-0 z-[5] w-px bg-slate-200 dark:bg-zinc-600"
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
                className="absolute left-0 top-full z-50 mt-1.5 w-full min-w-[200px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-zinc-800 dark:bg-indigo-dark-900"
              >
                {remaining.length === 0 ? (
                  <div className="flex items-center gap-2 px-3 py-2.5">
                    <Trophy size={13} className="shrink-0 text-amber-500" />
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      {t('allDueTodayDone')}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="border-b border-slate-100 px-3 py-2 dark:border-zinc-800">
                      <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500">
                        残り {remaining.length} 件
                      </span>
                    </div>
                    <ul className="py-1">
                      {popoverTasks.map((tk) => (
                        <li key={tk.id}>
                          <Link
                            href={`/tasks/${tk.id}`}
                            onClick={() => setIsHovered(false)}
                            className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-zinc-800/60 transition-colors"
                          >
                            <span
                              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                                tk.status === 'in-progress'
                                  ? 'bg-blue-400'
                                  : 'bg-slate-200 dark:bg-zinc-600'
                              }`}
                            />
                            <span className="min-w-0 truncate text-xs text-slate-700 dark:text-zinc-200">
                              {tk.title}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    {extraCount > 0 && (
                      <div className="border-t border-slate-100 px-3 py-1.5 dark:border-zinc-800">
                        <span className="text-[11px] text-slate-400 dark:text-zinc-500">
                          他 {extraCount} 件
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

    return (
      <>
        <div
          className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-md dark:shadow-[0_0_15px_rgba(0,0,0,0.5)] transition-all duration-300 hover:border-amber-500/50 dark:hover:border-amber-500/50 ${className}`}
        >
          {/* Mechanical Scanline on hover */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-amber-400 to-transparent opacity-0 transition-opacity group-hover:opacity-10 h-1/2 animate-pulse" />

          {/* Header: Task Command Center */}
          <div className="mb-4 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <Cpu size={16} className="animate-pulse text-amber-500" />
              <div>
                <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.4em] text-amber-600/70 dark:text-amber-500/50">
                  DAILY PROTOCOL
                </p>
                <h3 className="flex items-center gap-2 font-mono text-sm font-black tracking-tighter text-slate-800 dark:text-slate-100">
                  TASK_PROGRESS_INDEX
                  {efficiency === 100 && totalCount > 0 && (
                    <>
                      <motion.div
                        initial={{ scale: 0, rotate: -180 }}
                        animate={{
                          scale: [1, 1.2, 1],
                          rotate: 0,
                        }}
                        transition={{
                          scale: { repeat: Infinity, duration: 1.5 },
                          rotate: {
                            type: 'spring',
                            stiffness: 260,
                            damping: 20,
                          },
                        }}
                      >
                        <Trophy size={16} className="text-amber-500" />
                      </motion.div>
                      <span className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-mono font-bold uppercase tracking-wider bg-green-500 text-white rounded-full shadow-md animate-slide-in">
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={3}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        Completed!
                      </span>
                    </>
                  )}
                </h3>
              </div>
            </div>
          </div>

          {/* Progress Bar with Percentage */}
          <div className="flex items-center gap-4">
            {/* Progress Bar Container with Vertical Lines */}
            <div className="relative flex-1">
              <div className="relative h-6 w-full overflow-hidden bg-slate-200 dark:bg-slate-800 rounded">
                <motion.div
                  animate={{ width: `${efficiency}%` }}
                  className={`h-full transition-all duration-1000 ${
                    efficiency === 100
                      ? 'bg-gradient-to-r from-amber-500 to-amber-400 shadow-[0_0_10px_#fbbf24]'
                      : efficiency >= 75
                        ? 'bg-amber-500/80'
                        : efficiency >= 50
                          ? 'bg-slate-500 dark:bg-slate-400'
                          : 'bg-slate-400 dark:bg-slate-600'
                  }`}
                />

                {/* Vertical Gauge Lines */}
                <div className="absolute inset-0 flex">
                  {[25, 50, 75].map((percent) => (
                    <div
                      key={percent}
                      className="absolute top-0 h-full w-[1px] bg-slate-400 dark:bg-slate-600"
                      style={{ left: `${percent}%` }}
                    />
                  ))}
                </div>
              </div>

              {/* Gauge Labels */}
              <div className="mt-1 flex justify-between">
                {[0, 25, 50, 75, 100].map((m) => (
                  <span key={m} className="font-mono text-[8px] text-slate-500 dark:text-slate-700">
                    {m}
                  </span>
                ))}
              </div>
            </div>

            {/* Percentage and Count Display */}
            <div className="text-right">
              <p
                className={`font-mono text-2xl font-black ${
                  efficiency === 100
                    ? 'text-amber-500 dark:text-amber-400'
                    : 'text-slate-700 dark:text-slate-200'
                }`}
              >
                {efficiency}%
              </p>
              <p className="font-mono text-xs text-slate-500 dark:text-slate-600">
                ({completedCount}/{totalCount})
              </p>
            </div>
          </div>

          {/* Status Indicators */}
          <div className="mt-4 flex items-center justify-between font-mono text-[10px] text-slate-500 dark:text-slate-700">
            <div className="flex items-center gap-4">
              <span>MEM_USAGE: LOW</span>
              <span>
                PRODUCTIVITY: {efficiency >= 80 ? 'HIGH' : efficiency >= 50 ? 'MED' : 'LOW'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <Activity
                size={12}
                className={`${efficiency >= 50 ? 'text-amber-500/50' : 'text-slate-400 dark:text-slate-700'} animate-pulse`}
              />
              <span>SYSTEM_ACTIVE</span>
            </div>
          </div>

          {/* Effects Container */}
          <AnimatePresence>
            {showEffects && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                {particleData.map((data, i) => (
                  <GoldParticle key={i} x={50} y={40} angle={data.angle} distance={data.distance} />
                ))}
                <CynicalPopup x={50} y={40} msg={popupMsg} />
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Fabulous Overlay on 100% */}
        <AnimatePresence>
          {systemCritical && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-amber-500/10 dark:bg-amber-500/10 backdrop-blur-[1px]"
            >
              <div className="text-center">
                <motion.div
                  initial={{ scale: 0, rotate: 180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  className="mb-4 inline-block border-2 border-amber-500 bg-white dark:bg-black p-8 shadow-[0_0_50px_rgba(251,191,36,0.3)]"
                >
                  <Award size={64} className="mx-auto mb-4 text-amber-500 dark:text-amber-400" />
                  <h2 className="font-mono text-4xl font-black italic tracking-tighter text-slate-800 dark:text-white">
                    F-A-B-U-L-O-U-S
                  </h2>
                  <p className="mt-2 font-mono text-xs tracking-[0.5em] text-amber-600 dark:text-amber-500">
                    DAILY OBJECTIVE: COMPLETE
                  </p>
                </motion.div>

                {/* Rain of Gold */}
                {rainEffectData.map((data, i) => (
                  <motion.div
                    key={i}
                    initial={{
                      y: -100,
                      x: data.x,
                      opacity: 1,
                    }}
                    animate={{ y: 800, opacity: 0 }}
                    transition={{ duration: 2, delay: i * 0.1, ease: 'linear' }}
                    className="absolute font-mono text-[8px] text-amber-500/40"
                  >
                    {data.text}
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </>
    );
  },
);

TodayTaskProgressBar.displayName = 'TodayTaskProgressBar';

export default TodayTaskProgressBar;
