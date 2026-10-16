/**
 * TodayTaskProgressBarFull
 *
 * Full-size "DAILY PROTOCOL" render of TodayTaskProgressBar, including the
 * gold-particle/cynical-popup celebration and the full-screen "FABULOUS"
 * overlay on 100%. Extracted from TodayTaskProgressBar.tsx to keep that file
 * under the size limit; markup and behavior are unchanged.
 */
'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { Cpu, Activity, Award, Trophy } from 'lucide-react';
import { GoldParticle, CynicalPopup } from './TodayTaskProgressBar.parts';

interface ParticleDatum {
  angle: number;
  distance: number;
}

interface RainDatum {
  x: number;
  text: string;
}

export interface TodayTaskProgressBarFullProps {
  className: string;
  completedCount: number;
  totalCount: number;
  efficiency: number;
  showEffects: boolean;
  systemCritical: boolean;
  particleData: ParticleDatum[];
  popupMsg: string;
  rainEffectData: RainDatum[];
}

/** Full-size "DAILY PROTOCOL" render of the due-today progress widget. */
export default function TodayTaskProgressBarFull({
  className,
  completedCount,
  totalCount,
  efficiency,
  showEffects,
  systemCritical,
  particleData,
  popupMsg,
  rainEffectData,
}: TodayTaskProgressBarFullProps) {
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
}
