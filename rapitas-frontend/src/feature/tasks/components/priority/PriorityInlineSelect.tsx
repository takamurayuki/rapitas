'use client';
/**
 * PriorityInlineSelect
 *
 * Click the priority icon to change a task's priority inline, without opening
 * the edit screen. Reuses the shared priority option list for consistency.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';
import PriorityIcon from './PriorityIcon';
import { usePriorityOptions } from '@/app/tasks/new/components/PrioritySelector';

interface PriorityInlineSelectProps {
  /** Current priority. */
  value: Priority | null | undefined;
  /** Called with the chosen priority. */
  onChange: (priority: Priority) => void;
}

/**
 * Icon-trigger popover for picking a task priority inline.
 *
 * @param props - See {@link PriorityInlineSelectProps}
 * @returns The priority icon button with a popover of options.
 */
export default function PriorityInlineSelect({ value, onChange }: PriorityInlineSelectProps) {
  const t = useTranslations('task');
  const options = usePriorityOptions(t);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`優先度: ${current?.label ?? '未設定'}（クリックで変更）`}
        title="優先度を変更"
        className="flex items-center rounded p-0.5 outline-none transition-colors hover:bg-zinc-100 focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-zinc-800"
      >
        {value ? (
          <PriorityIcon priority={value} size="md" />
        ) : (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">優先度</span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-36 rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                if (opt.value !== value) onChange(opt.value);
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                opt.value === value ? 'bg-zinc-50 dark:bg-zinc-800/50' : ''
              }`}
            >
              <span className={opt.iconColor}>{opt.icon}</span>
              <span className="text-zinc-700 dark:text-zinc-300">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
