'use client';
/**
 * TaskDetailQuickNav
 *
 * Sticky chip bar that jumps the task detail to a section (info / AI / workflow
 * / subtasks) via scrollIntoView, so the long detail panel doesn't have to be
 * scrolled manually each time. Renders nothing when there is only one section.
 */
import type { LucideIcon } from 'lucide-react';

/** One jumpable section. The id must match the section element's id. */
export interface QuickNavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

/**
 * @param sections - Sections present in the current task detail / 表示中のセクション
 */
export function TaskDetailQuickNav({ sections }: { sections: QuickNavSection[] }) {
  if (sections.length <= 1) return null;

  const jumpTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="sticky top-0 z-10 flex items-center gap-1.5 overflow-x-auto border-b border-zinc-200 bg-white/95 px-3 py-1.5 backdrop-blur scrollbar-thin dark:border-zinc-800 dark:bg-zinc-900/95">
      {sections.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => jumpTo(id)}
          title={label}
          className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>
  );
}
