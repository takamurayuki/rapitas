/**
 * TodayTaskProgressBar.parts
 *
 * Small presentational pieces (particle/popup effects) and copy constants
 * shared by the full-size TodayTaskProgressBar render. Extracted from
 * TodayTaskProgressBar.tsx to keep that file under the size limit.
 */
'use client';
import { motion } from 'framer-motion';
import { Zap } from 'lucide-react';

/** Randomly-picked flavor line shown next to the gold-particle burst on 100%. */
export const PROGRESS_MESSAGES = [
  'Surprisingly adequate.',
  'Is that all?',
  "Don't get used to it.",
  'Efficiency: Acceptable.',
  'Human error minimized.',
  'Fabulous effort, I guess.',
  'One less failure.',
  'Absolute perfection. Finally.',
];

export const GoldParticle = ({
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

export const CynicalPopup = ({ x, y, msg }: { x: number; y: number; msg: string }) => {
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
