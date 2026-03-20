/**
 * subtask-section/types
 *
 * Shared type definitions for the SubtaskSection component family.
 * Does not contain React components or side effects.
 */

import type { Priority } from '@/types';
import { ArrowDown, ArrowUp, Minus, AlertTriangle } from 'lucide-react';
import React from 'react';

export interface PriorityOption {
  value: Priority;
  icon: React.ReactNode;
  color: string;
  activeBg: string;
  activeBorder: string;
}

export const priorityOptions: PriorityOption[] = [
  {
    value: 'low',
    icon: React.createElement(ArrowDown, { className: 'w-3.5 h-3.5' }),
    color: 'text-blue-500',
    activeBg: 'bg-blue-50 dark:bg-blue-900/30',
    activeBorder: 'border-blue-400 dark:border-blue-500',
  },
  {
    value: 'medium',
    icon: React.createElement(Minus, { className: 'w-3.5 h-3.5' }),
    color: 'text-yellow-500',
    activeBg: 'bg-yellow-50 dark:bg-yellow-900/30',
    activeBorder: 'border-yellow-400 dark:border-yellow-500',
  },
  {
    value: 'high',
    icon: React.createElement(ArrowUp, { className: 'w-3.5 h-3.5' }),
    color: 'text-orange-500',
    activeBg: 'bg-orange-50 dark:bg-orange-900/30',
    activeBorder: 'border-orange-400 dark:border-orange-500',
  },
  {
    value: 'urgent',
    icon: React.createElement(AlertTriangle, { className: 'w-3.5 h-3.5' }),
    color: 'text-red-500',
    activeBg: 'bg-red-50 dark:bg-red-900/30',
    activeBorder: 'border-red-400 dark:border-red-500',
  },
];
