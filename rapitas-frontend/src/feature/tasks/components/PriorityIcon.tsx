'use client';

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  ChevronsUp,
  type LucideIcon,
} from 'lucide-react';
import type { Priority } from '@/types';

interface PriorityConfig {
  Icon: LucideIcon;
  color: string;
  title: string;
}

const priorityConfig: Record<Priority, PriorityConfig> = {
  urgent: {
    Icon: ChevronsUp,
    color: 'text-red-500',
    title: '緊急',
  },
  high: {
    Icon: ChevronUp,
    color: 'text-orange-500',
    title: '高',
  },
  medium: {
    Icon: ChevronsUpDown,
    color: 'text-blue-400',
    title: '中',
  },
  low: {
    Icon: ChevronDown,
    color: 'text-gray-400',
    title: '低',
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
  if (!priority) return null;

  const config = priorityConfig[priority];
  if (!config) return null;

  const sizeClasses = {
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
    lg: 'w-5 h-5',
  };

  const { Icon } = config;

  return (
    <span
      className={`shrink-0 flex items-center gap-1 ${config.color}`}
      title={config.title}
    >
      <Icon className={sizeClasses[size]} />
      {showTitle && <span className="text-xs font-medium">{config.title}</span>}
    </span>
  );
}

export { priorityConfig };
export type { PriorityConfig };
