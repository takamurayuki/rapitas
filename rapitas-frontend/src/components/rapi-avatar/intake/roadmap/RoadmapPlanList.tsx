'use client';
/**
 * RoadmapPlanList
 *
 * The drafted steps as the user reviews them: grouped under their milestone
 * (節目) with its criteria when the plan has milestones, as a flat list
 * otherwise. Display only — what is shown here is what gets created.
 */
import { Milestone as MilestoneIcon } from 'lucide-react';
import type { Milestone, Step } from './roadmap.types';

interface RoadmapPlanListProps {
  steps: Step[];
  milestones?: Milestone[];
}

function StepItem({ step }: { step: Step }) {
  return (
    <li className="rounded border border-zinc-200 p-1.5 dark:border-zinc-700">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium text-zinc-800 dark:text-zinc-100">
          {step.title}
        </span>
        {step.dueDate && <span className="shrink-0 text-[10px] text-zinc-400">{step.dueDate}</span>}
      </span>
      <span className="block whitespace-pre-wrap text-[10px] text-zinc-500 dark:text-zinc-400">
        {step.description}
      </span>
    </li>
  );
}

/**
 * Renders the plan's steps, grouped by milestone when there are milestones.
 *
 * @param steps - The drafted steps / 下書きのステップ
 * @param milestones - The drafted milestones, if any / 下書きの節目
 */
export function RoadmapPlanList({ steps, milestones = [] }: RoadmapPlanListProps) {
  if (milestones.length === 0) {
    return (
      <ul className="max-h-52 space-y-1 overflow-y-auto">
        {steps.map((s) => (
          <StepItem key={s.title} step={s} />
        ))}
      </ul>
    );
  }

  const loose = steps.filter((s) => s.milestoneIndex === undefined);
  return (
    <div className="max-h-64 space-y-2 overflow-y-auto">
      {milestones.map((m, i) => (
        <section
          key={`${i}-${m.name}`}
          data-testid={`roadmap-milestone-${i}`}
          className="rounded border border-indigo-200 p-1.5 dark:border-indigo-900/60"
        >
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1 text-[11px] font-semibold text-indigo-700 dark:text-indigo-300">
              <MilestoneIcon className="h-3 w-3 shrink-0" />
              {m.name}
            </span>
            {m.dueDate && <span className="shrink-0 text-[10px] text-zinc-400">{m.dueDate}</span>}
          </div>
          {m.acceptanceCriteria.length > 0 && (
            <ul className="mb-1 list-disc pl-4 text-[10px] text-zinc-600 dark:text-zinc-300">
              {m.acceptanceCriteria.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <ul className="space-y-1">
            {steps
              .filter((s) => s.milestoneIndex === i)
              .map((s) => (
                <StepItem key={s.title} step={s} />
              ))}
          </ul>
        </section>
      ))}
      {loose.length > 0 && (
        <ul className="space-y-1">
          {loose.map((s) => (
            <StepItem key={s.title} step={s} />
          ))}
        </ul>
      )}
    </div>
  );
}
