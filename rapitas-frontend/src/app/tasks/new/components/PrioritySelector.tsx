'use client';
// PrioritySelector
import {
  ChevronsUp,
  ChevronUp,
  ChevronsUpDown,
  ChevronDown,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';

/** A single priority option descriptor. */
export interface PriorityOption {
  value: Priority;
  label: string;
  icon: React.ReactNode;
  iconColor: string;
  bgColor: string;
}

/**
 * Builds the ordered list of priority options using translated labels.
 *
 * @param t - Translation function for the 'task' namespace / タスク名前空間の翻訳関数
 * @returns Array of priority option objects.
 */
export function usePriorityOptions(
  t: ReturnType<typeof useTranslations>,
): PriorityOption[] {
  return [
    {
      value: 'urgent',
      label: t('priorityCritical'),
      icon: <ChevronsUp className="w-3.5 h-3.5" />,
      iconColor: 'text-red-500',
      bgColor: 'bg-red-500',
    },
    {
      value: 'high',
      label: t('priorityHigh'),
      icon: <ChevronUp className="w-3.5 h-3.5" />,
      iconColor: 'text-orange-500',
      bgColor: 'bg-orange-500',
    },
    {
      value: 'medium',
      label: t('priorityMedium'),
      icon: <ChevronsUpDown className="w-3.5 h-3.5" />,
      iconColor: 'text-blue-500',
      bgColor: 'bg-blue-500',
    },
    {
      value: 'low',
      label: t('priorityLow'),
      icon: <ChevronDown className="w-3.5 h-3.5" />,
      iconColor: 'text-zinc-400',
      bgColor: 'bg-zinc-500',
    },
  ];
}

interface PrioritySelectorProps {
  /** Currently selected priority value. */
  value: Priority;
  /** Called when the user clicks a priority button. */
  onChange: (value: Priority) => void;
  /** Pre-built option list; if omitted the component builds its own via useTranslations. */
  options?: PriorityOption[];
}

/**
 * Renders a horizontal row of priority selection buttons.
 *
 * @param props.value - Active priority / 現在の優先度
 * @param props.onChange - Change handler / 変更ハンドラ
 * @param props.options - Optional pre-built options list / オプションリスト（省略可）
 */
export function PrioritySelector({
  value,
  onChange,
  options,
}: PrioritySelectorProps) {
  const t = useTranslations('task');
  const defaultOptions = usePriorityOptions(t);
  const priorityOptions = options ?? defaultOptions;

  return (
    <div className="flex items-center gap-1">
      {priorityOptions.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
            value === opt.value
              ? `${opt.bgColor} text-white shadow-md`
              : 'bg-white dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700'
          }`}
        >
          <span className={value === opt.value ? 'text-white' : opt.iconColor}>
            {opt.icon}
          </span>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
