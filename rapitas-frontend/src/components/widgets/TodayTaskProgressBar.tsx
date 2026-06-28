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
      // ── Variant A: Segmented block bar (10 equal blocks) ──────────────────
      // Classic retro HP-bar feel. Each block = 10% progress, fills in
      // left-to-right with a staggered delay so you see the blocks "pop on."
      const blockBar = (
        <div className="flex h-2 w-full gap-[2px]">
          {Array.from({ length: 10 }, (_, i) => {
            const lit = efficiency >= (i + 1) * 10;
            const partial = !lit && efficiency > i * 10;
            return (
              <div
                key={i}
                className="relative flex-1 overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800"
              >
                {(lit || partial) && (
                  <motion.div
                    className="absolute inset-y-0 left-0 bg-indigo-500 dark:bg-indigo-400"
                    initial={{ width: '0%' }}
                    animate={{ width: lit ? '100%' : `${((efficiency - i * 10) / 10) * 100}%` }}
                    transition={{ duration: 0.35, delay: lit ? i * 0.025 : 0 }}
                  />
                )}
              </div>
            );
          })}
        </div>
      );

      // ── Variant B: Circuit node path ───────────────────────────────────────
      // 5 nodes connected by lines. Completed segments glow indigo; the
      // frontier node pulses to show where work is happening.
      const circuitBar = (
        <div className="flex h-4 w-full items-center">
          {Array.from({ length: 5 }, (_, i) => {
            const threshold = (i / 4) * 100;
            const filled = efficiency >= threshold;
            const isFrontier = filled && (i === 4 || efficiency < ((i + 1) / 4) * 100);
            return (
              <React.Fragment key={i}>
                {i > 0 && (
                  <div className="relative h-px flex-1 bg-zinc-300 dark:bg-zinc-700">
                    <motion.div
                      className="absolute inset-y-0 left-0 bg-indigo-500 dark:bg-indigo-400"
                      initial={{ width: '0%' }}
                      animate={{ width: filled ? '100%' : '0%' }}
                      transition={{ duration: 0.4 }}
                    />
                  </div>
                )}
                <motion.div
                  className={`h-2 w-2 shrink-0 rounded-full border ${
                    filled
                      ? 'bg-indigo-500 dark:bg-indigo-400 border-indigo-300 dark:border-indigo-300'
                      : 'bg-white dark:bg-zinc-900 border-zinc-400 dark:border-zinc-600'
                  }`}
                  animate={isFrontier && efficiency > 0 ? { scale: [1, 1.35, 1] } : {}}
                  transition={{ repeat: Infinity, duration: 1.4 }}
                />
              </React.Fragment>
            );
          })}
        </div>
      );

      // ── Variant C: Diagonal-stripe scanline bar ────────────────────────────
      // Fill is rendered as diagonal chevron stripes (like caution tape).
      // A bright leading-edge flash marks the current progress point.
      // Horizontal CRT scanlines overlay gives the widget a terminal feel.
      const scanlineBar = (
        <div className="relative h-2.5 w-full overflow-hidden rounded-sm bg-zinc-200 dark:bg-zinc-800">
          <motion.div
            className="absolute inset-y-0 left-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(45deg,#6366f1 0px,#6366f1 3px,#818cf8 3px,#818cf8 6px)',
            }}
            initial={{ width: '0%' }}
            animate={{ width: `${efficiency}%` }}
            transition={{ duration: 0.8, ease: 'easeOut' }}
          />
          {/* Horizontal scanline texture */}
          <div
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                'repeating-linear-gradient(0deg,transparent,transparent 1px,rgba(0,0,0,0.1) 1px,rgba(0,0,0,0.1) 2px)',
            }}
          />
          {/* Leading-edge flash */}
          {efficiency > 0 && efficiency < 100 && (
            <motion.div
              className="absolute top-0 h-full w-0.5 bg-white/75"
              animate={{ left: `calc(${efficiency}% - 1px)` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          )}
        </div>
      );

      return (
        <div
          className={`relative overflow-hidden border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 shadow-sm transition-all duration-300 hover:border-amber-500/50 ${className}`}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {efficiency === 100 && (
                <motion.div
                  initial={{ scale: 0, rotate: -180 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                >
                  <Trophy size={14} className="text-amber-500" />
                </motion.div>
              )}
              <p className="text-xs font-medium text-slate-800 dark:text-slate-100">
                {t('todayTask')}
              </p>
            </div>
            <p className="text-xs font-medium text-slate-500 dark:text-slate-600">
              ({completedCount}/{totalCount})
            </p>
          </div>

          {/* Three progress bar designs stacked for comparison */}
          <div className="mt-2 space-y-2">
            <div className="space-y-0.5">
              <p className="text-[8px] font-mono uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                BLOCK
              </p>
              {blockBar}
            </div>
            <div className="space-y-0.5">
              <p className="text-[8px] font-mono uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                CIRCUIT
              </p>
              {circuitBar}
            </div>
            <div className="space-y-0.5">
              <p className="text-[8px] font-mono uppercase tracking-widest text-zinc-400 dark:text-zinc-600">
                SCANLINE
              </p>
              {scanlineBar}
            </div>
          </div>
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
