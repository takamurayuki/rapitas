'use client';

import { useEffect, useState } from 'react';

interface TaskCompleteOverlayProps {
  show: boolean;
  onComplete?: () => void;
}

export default function TaskCompleteOverlay({ show, onComplete }: TaskCompleteOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (show) {
      // Set on next render cycle
      const showTimer = setTimeout(() => setVisible(true), 0);
      const hideTimer = setTimeout(() => {
        setVisible(false);
        onComplete?.();
      }, 1500);
      return () => {
        clearTimeout(showTimer);
        clearTimeout(hideTimer);
      };
    }
  }, [show, onComplete]);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 grid place-items-center z-50 pointer-events-none overflow-hidden">
      {/* Background flash */}
      <div className="absolute inset-0 bg-white/30 animate-task-complete-fade-out"></div>

      {/* Container: center-stacked via grid */}
      <div className="relative grid place-items-center w-full h-full">
        {/* Ripple effect (SVG) */}
        {[0, 1, 2].map((i) => (
          <svg
            key={i}
            className="absolute opacity-0"
            width="300"
            height="300"
            viewBox="0 0 100 100"
            style={{
              // Renamed animation from triangle-ripple to task-complete-ripple
              animation: `task-complete-ripple 2.8s cubic-bezier(0.22, 1, 0.36, 1) forwards ${i * 0.28}s`,
            }}
          >
            <polygon
              points="50,5 5,95 95,95"
              fill="none"
              stroke="rgba(129, 140, 248, 0.5)"
              strokeWidth="2"
            />
          </svg>
        ))}

        {/* Expanding main triangle and text */}
        {/* Renamed class from animate-triangle-grow to animate-task-complete-grow */}
        <div className="relative grid place-items-center animate-task-complete-grow z-10">
          {/* Main SVG Triangle */}
          <svg
            width="240"
            height="240"
            viewBox="0 0 100 100"
            className="drop-shadow-2xl opacity-90"
          >
            <defs>
              <linearGradient id="triGradient" x1="0%" y1="100%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#4f46e5" /> {/* indigo-600 */}
                <stop offset="100%" stopColor="#a855f7" /> {/* purple-500 */}
              </linearGradient>
            </defs>
            <polygon points="50,5 5,95 95,95" fill="url(#triGradient)" />
          </svg>

          {/* Text */}
          <span className="absolute top-[62%] text-white font-black text-xl tracking-[0.2em] uppercase drop-shadow-md whitespace-nowrap">
            Complete
          </span>
        </div>
      </div>
    </div>
  );
}
