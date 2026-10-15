'use client';

import { ChevronDown, ChevronsUpDown, ChevronUp, ChevronsUp, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Priority } from '@/types';

interface PriorityConfig {
  Icon: LucideIcon;
  color: string;
  /** i18n key into the `task` namespace — resolve via t(titleKey), not a raw string. */
  titleKey: string;
}

const priorityConfig: Record<Priority, PriorityConfig> = {
  urgent: {
    Icon: ChevronsUp,
    color: 'text-red-500',
    titleKey: 'priorityUrgent',
  },
  high: {
    Icon: ChevronUp,
    color: 'text-orange-500',
    titleKey: 'priorityHigh',
  },
  medium: {
    Icon: ChevronsUpDown,
    color: 'text-blue-400',
    titleKey: 'priorityMedium',
  },
  low: {
    Icon: ChevronDown,
    color: 'text-gray-400',
    titleKey: 'priorityLow',
  },
};

interface PriorityIconProps {
  priority: Priority | null | undefined;
  size?: 'sm' | 'md' | 'lg';
  showTitle?: boolean;
}

export default function PriorityIcon({
  priority,
  size = 'md',
  showTitle = false,
}: PriorityIconProps) {
  const t = useTranslations('task');
  if (!priority) return null;

  const config = priorityConfig[priority];
  if (!config) return null;

  const sizeClasses = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const { Icon } = config;
  const title = t(config.titleKey);

  return (
    <span className={`shrink-0 flex items-center gap-1 ${config.color}`} title={title}>
      <Icon className={sizeClasses[size]} />
      {showTitle && <span className="text-xs font-medium">{title}</span>}
    </span>
  );
}

export { priorityConfig };
export type { PriorityConfig };
