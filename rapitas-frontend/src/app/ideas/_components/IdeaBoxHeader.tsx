'use client';
import { useEffect, useState } from 'react';
import { Lightbulb, Plus } from 'lucide-react';

interface IdeaBoxHeaderProps {
  totalIdeas: number;
  onAddClick: () => void;
}

/**
 * Header for the IdeaBox page. Shows a lightbulb with "flash lines"
 * animation when a new idea is added (like a eureka moment).
 */
export function IdeaBoxHeader({ totalIdeas, onAddClick }: IdeaBoxHeaderProps) {
  const [isPinging, setIsPinging] = useState(false);
  const [prevCount, setPrevCount] = useState(totalIdeas);

  useEffect(() => {
    if (totalIdeas > prevCount && prevCount > 0) {
      setIsPinging(true);
      const timer = setTimeout(() => setIsPinging(false), 800);
      setPrevCount(totalIdeas);
      return () => clearTimeout(timer);
    }
    setPrevCount(totalIdeas);
  }, [totalIdeas, prevCount]);

  const statusText =
    totalIdeas === 0
      ? 'ひらめきを気軽にメモ'
      : `${totalIdeas}件のアイデア`;

  return (
    <div className="flex items-center justify-between mb-6">
      <div className="flex items-center gap-3">
        {/* Lightbulb with flash lines inside box-shaped container */}
        <div className="relative flex h-12 w-12 items-end justify-center rounded-xl border-2 border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 overflow-hidden">
          <Lightbulb
            className={`h-5 w-5 mb-1 transition-all ${
              isPinging
                ? 'text-yellow-400 scale-110 drop-shadow-[0_0_6px_rgba(250,204,21,0.8)]'
                : 'text-amber-600 dark:text-amber-400 scale-100'
            }`}
            style={{ transitionDuration: isPinging ? '100ms' : '300ms' }}
          />
          {/* Three flash lines — eureka effect */}
          {/* Three flash lines above the bulb, inside the box */}
          {isPinging && (
            <>
              <span className="absolute top-1.5 left-1/2 -translate-x-1/2 w-0.5 h-2 bg-yellow-400 rounded-full animate-[flash-line_0.6s_ease-out_forwards]" />
              <span className="absolute top-2 left-2.5 w-0.5 h-1.5 bg-yellow-400 rounded-full rotate-[-30deg] animate-[flash-line_0.6s_ease-out_0.05s_forwards]" />
              <span className="absolute top-2 right-2.5 w-0.5 h-1.5 bg-yellow-400 rounded-full rotate-[30deg] animate-[flash-line_0.6s_ease-out_0.1s_forwards]" />
            </>
          )}
        </div>
        <div>
          <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
            アイデアボックス
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusText}</p>
        </div>
      </div>
      <button
        onClick={onAddClick}
        className="flex items-center gap-2 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-700 transition-colors"
      >
        <Plus className="h-4 w-4" />
        アイデアを追加
      </button>
    </div>
  );
}
