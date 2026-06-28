'use client';
import React, { memo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Activity, Award, Zap, Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';

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
  completedCount: number;
  totalCount: number;
  className?: string;
  compact?: boolean;
}

const TodayTaskProgressBar = memo<TodayTaskProgressBarProps>(
  ({ completedCount, totalCount, className = '', compact = false }) => {
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
      const fillCls = isDone
        ? 'bg-gradient-to-r from-emerald-400 to-emerald-500'
        : 'bg-gradient-to-r from-indigo-400 to-indigo-600';

      // ── A: Ridge ─────────────────────────────────────────────────────────────
      // Same bottom-ridge language as the toolbar buttons (indigo → emerald).
      // The fill bar has a looping shine sweep that signals "this is alive."
      const designA = (
        <div
          className={`rounded-xl border px-3 py-2 transition-all duration-500 ${
            isDone
              ? 'border-emerald-200 bg-white shadow-[0_2px_0_0_#6ee7b7] dark:border-emerald-800 dark:bg-zinc-900 dark:shadow-[0_2px_0_0_#065f46]'
              : 'border-indigo-200 bg-white shadow-[0_2px_0_0_#c7d2fe] dark:border-indigo-800 dark:bg-zinc-900 dark:shadow-[0_2px_0_0_#312e81]'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {isDone && (
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                >
                  <Trophy size={11} className="text-amber-400" />
                </motion.div>
              )}
              <span className="text-[10px] font-medium text-slate-600 dark:text-zinc-400">
                {t('todayTask')}
              </span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-[9px] tabular-nums text-slate-400 dark:text-zinc-600">
                {completedCount}/{totalCount}
              </span>
              <span
                className={`text-xs font-bold tabular-nums ${isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}
              >
                {efficiency}%
              </span>
            </div>
          </div>
          {/* Fill bar with looping shine — clipped inside overflow-hidden */}
          <div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
            <motion.div
              className={`absolute inset-y-0 left-0 overflow-hidden rounded-full ${fillCls}`}
              animate={{ width: `${efficiency}%` }}
              transition={{ duration: 0.7, ease: 'easeOut' }}
            >
              <motion.div
                className="absolute inset-y-0 w-[50%]"
                style={{
                  background:
                    'linear-gradient(to right,transparent,rgba(255,255,255,0.35),transparent)',
                }}
                animate={{ left: ['-50%', '130%'] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut', repeatDelay: 1.5 }}
              />
            </motion.div>
          </div>
        </div>
      );

      // ── B: Capsule ────────────────────────────────────────────────────────────
      // A rounded-full pill that floods with a tinted fill as tasks complete.
      // Semi-transparent fill keeps the text readable at any progress level.
      const designB = (
        <div className="relative h-9 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-zinc-700 dark:bg-zinc-800">
          <motion.div
            className={`absolute inset-y-0 left-0 rounded-full ${isDone ? 'bg-emerald-400/75' : 'bg-indigo-500/75'}`}
            animate={{ width: `${efficiency}%` }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
          {/* Top highlight gives the pill a convex feel */}
          <div className="pointer-events-none absolute inset-x-0 top-0 h-[45%] rounded-t-full bg-white/20 dark:bg-white/10" />
          <div className="absolute inset-0 flex items-center justify-between px-4">
            <div className="flex items-center gap-1.5">
              {isDone && <Trophy size={11} className="text-amber-500" />}
              <span className="text-[10px] font-semibold text-slate-700 dark:text-zinc-200">
                {t('todayTask')}
              </span>
            </div>
            <span
              className={`text-xs font-black tabular-nums ${isDone ? 'text-emerald-700 dark:text-emerald-300' : 'text-indigo-700 dark:text-indigo-300'}`}
            >
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>
      );

      // ── C: Ticker ─────────────────────────────────────────────────────────────
      // Split layout: large hero task-count on the left (pops when count changes),
      // label + thin bar on the right. Feels like a game score panel.
      const designC = (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
          <div className="flex items-stretch">
            {/* Left panel: large task counter with accent tint */}
            <div
              className={`flex shrink-0 flex-col items-center justify-center px-3 py-2 transition-colors duration-500 ${
                isDone
                  ? 'bg-emerald-50 dark:bg-emerald-950/40'
                  : 'bg-indigo-50 dark:bg-indigo-950/30'
              }`}
            >
              <motion.span
                key={completedCount}
                initial={{ scale: 1.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                className={`font-mono text-lg font-black tabular-nums leading-none ${isDone ? 'text-emerald-600 dark:text-emerald-400' : 'text-indigo-600 dark:text-indigo-400'}`}
              >
                {completedCount}
              </motion.span>
              <span className="mt-0.5 text-[8px] font-mono tabular-nums text-slate-400 dark:text-zinc-600">
                /{totalCount}
              </span>
            </div>
            {/* Divider */}
            <div
              className={`w-px shrink-0 transition-colors duration-500 ${isDone ? 'bg-emerald-100 dark:bg-emerald-900/50' : 'bg-indigo-100 dark:bg-indigo-900/40'}`}
            />
            {/* Right panel: label, bar, percentage */}
            <div className="flex flex-1 flex-col justify-center gap-1 px-2.5 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-medium text-slate-500 dark:text-zinc-500">
                  {t('todayTask')}
                </span>
                <span
                  className={`text-[9px] font-bold tabular-nums ${isDone ? 'text-emerald-500' : 'text-slate-400 dark:text-zinc-500'}`}
                >
                  {efficiency}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                <motion.div
                  className={`h-full rounded-full ${fillCls}`}
                  animate={{ width: `${efficiency}%` }}
                  transition={{ duration: 0.7, ease: 'easeOut' }}
                />
              </div>
            </div>
          </div>
        </div>
      );

      return (
        <div className={`space-y-1.5 ${className}`}>
          {designA}
          {designB}
          {designC}
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
