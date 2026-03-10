'use client';
import React, { useState } from 'react';
import TodayTaskProgressBar from './TodayTaskProgressBar';

export default function TodayTaskProgressBarExample() {
  const [example1Completed, setExample1Completed] = useState(2);
  const [example2Completed, setExample2Completed] = useState(5);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black p-8">
      {/* Grid Overlay */}
      <div className="pointer-events-none fixed inset-0 bg-[url('https://www.transparenttextures.com/patterns/grid-me.png')] opacity-[0.03]" />

      <div className="relative z-10 mx-auto max-w-4xl space-y-8">
        <div className="mb-8 border-l-4 border-amber-600 py-2 pl-6">
          <h1 className="mb-4 font-mono text-3xl font-black tracking-tighter text-slate-800 dark:text-slate-100">
            TODAY_TASK_PROGRESS_BAR{' '}
            <span className="text-amber-500">{/* EXAMPLES */}</span>
          </h1>
        </div>

        {/* 通常の状態 */}
        <div>
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            [001] NORMAL PROGRESS (40% COMPLETE)
          </h2>
          <TodayTaskProgressBar completedCount={2} totalCount={5} />
          <div className="mt-2">
            <button
              onClick={() =>
                setExample1Completed((prev) => (prev < 5 ? prev + 1 : prev))
              }
              className="mr-2 bg-amber-500 px-3 py-1 font-mono text-xs font-bold uppercase text-black transition-all hover:bg-amber-400 active:scale-95"
            >
              COMPLETE TASK
            </button>
            <button
              onClick={() => setExample1Completed(0)}
              className="bg-slate-800 px-3 py-1 font-mono text-xs font-bold uppercase text-slate-400 transition-all hover:bg-slate-700 active:scale-95"
            >
              RESET
            </button>
          </div>
        </div>

        {/* 全てのタスクが完了 */}
        <div>
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            [002] MAXIMUM EFFICIENCY (100% COMPLETE)
          </h2>
          <TodayTaskProgressBar completedCount={5} totalCount={5} />
        </div>

        {/* タスクがない状態 */}
        <div>
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            [003] NO TASKS ASSIGNED
          </h2>
          <TodayTaskProgressBar completedCount={0} totalCount={0} />
        </div>

        {/* 全て未着手 */}
        <div>
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            [004] ZERO PROGRESS (0% COMPLETE)
          </h2>
          <TodayTaskProgressBar completedCount={0} totalCount={8} />
        </div>

        {/* インタラクティブな例 */}
        <div>
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            [005] INTERACTIVE DEMONSTRATION
          </h2>
          <TodayTaskProgressBar
            completedCount={example2Completed}
            totalCount={10}
          />
          <div className="mt-4 flex gap-2">
            <button
              onClick={() =>
                setExample2Completed((prev) => (prev < 10 ? prev + 1 : prev))
              }
              className="bg-amber-500 px-4 py-2 font-mono text-xs font-bold uppercase text-black transition-all hover:bg-amber-400 active:scale-95"
            >
              COMPLETE TASK
            </button>
            <button
              onClick={() =>
                setExample2Completed((prev) => (prev > 0 ? prev - 1 : prev))
              }
              className="bg-slate-800 px-4 py-2 font-mono text-xs font-bold uppercase text-slate-400 transition-all hover:bg-slate-700 active:scale-95"
            >
              UNDO TASK
            </button>
            <button
              onClick={() => setExample2Completed(0)}
              className="bg-rose-900 px-4 py-2 font-mono text-xs font-bold uppercase text-rose-200 transition-all hover:bg-rose-800 active:scale-95"
            >
              RESET ALL
            </button>
            <button
              onClick={() => setExample2Completed(10)}
              className="bg-green-900 px-4 py-2 font-mono text-xs font-bold uppercase text-green-200 transition-all hover:bg-green-800 active:scale-95"
            >
              COMPLETE ALL
            </button>
          </div>
        </div>

        {/* Compact版の例 */}
        <div>
          <h2 className="mb-4 font-mono text-sm font-semibold uppercase tracking-widest text-slate-600 dark:text-slate-500">
            [006] COMPACT VERSION (FOR TASK LIST HEADER)
          </h2>
          <div className="space-y-2">
            <TodayTaskProgressBar completedCount={3} totalCount={5} compact />
            <TodayTaskProgressBar completedCount={10} totalCount={10} compact />
            <TodayTaskProgressBar completedCount={0} totalCount={3} compact />
          </div>
        </div>

        {/* Status Footer */}
        <div className="mt-12 flex items-center justify-between border-t border-slate-300 dark:border-slate-900 pt-4 font-mono text-[10px] text-slate-600 dark:text-slate-700">
          <div className="flex gap-4">
            <span>SYSTEM: DEMO_MODE</span>
            <span>VERSION: 1.0.0</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 animate-pulse rounded-full bg-amber-500/50" />
            <span>INTERACTIVE_EXAMPLES_LOADED</span>
          </div>
        </div>
      </div>
    </div>
  );
}
