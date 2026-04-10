/**
 * useNewTaskForm
 *
 * Thin combiner hook for the new-task page.
 * Composes useTaskFormData (remote data) and useTaskFormActions (API calls)
 * with the controlled form field state, and returns a single flat object
 * that the page component can spread onto its sub-components.
 */
'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Priority, Theme, WorkflowMode } from '@/types';
import { useLocaleStore } from '@/stores/locale-store';
import { toDateLocale } from '@/lib/utils';
import { useTaskFormData } from './useTaskFormData';
import { useTaskFormActions } from './useTaskFormActions';

/** Shape of a pending subtask before the parent task is created. */
export interface PendingSubtask {
  id: string;
  title: string;
  description?: string;
  priority?: Priority;
  labels?: string[];
  estimatedHours?: number;
}

/**
 * Combines all state, remote data, and action handlers for the new-task page.
 *
 * @returns Flat object of form values, setters, and handlers.
 */
export function useNewTaskForm() {
  const t = useTranslations('task');
  const tc = useTranslations('common');
  const locale = useLocaleStore((s) => s.locale);
  const dateLocale = toDateLocale(locale);

  // ── Controlled form fields ────────────────────────────────────────────────
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [themeId, setThemeId] = useState<number | null>(null);
  const [selectedLabelIds, setSelectedLabelIds] = useState<number[]>([]);
  const [estimatedHours, setEstimatedHours] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('comprehensive');
  const [isWorkflowModeOverride, setIsWorkflowModeOverride] = useState(false);

  // ── Remote data + derived values ──────────────────────────────────────────
  const { themes, categories, globalSettings, selectedTheme, visibleThemes } =
    useTaskFormData({ themeId, setThemeId });

  // ── Actions + UI state ────────────────────────────────────────────────────
  const actions = useTaskFormActions(
    {
      title,
      description,
      priority,
      themeId,
      selectedLabelIds,
      estimatedHours,
      dueDate,
      workflowMode,
      isWorkflowModeOverride,
      selectedTheme,
      globalSettings,
    },
    {
      setTitle,
      setDescription,
      setPriority,
      setEstimatedHours,
      setSelectedLabelIds,
    },
  );

  return {
    // translations
    t,
    tc,
    dateLocale,
    // core fields
    title,
    setTitle,
    description,
    setDescription,
    priority,
    setPriority,
    themeId,
    setThemeId,
    selectedLabelIds,
    setSelectedLabelIds,
    estimatedHours,
    setEstimatedHours,
    dueDate,
    setDueDate,
    workflowMode,
    setWorkflowMode,
    isWorkflowModeOverride,
    setIsWorkflowModeOverride,
    // remote data
    themes,
    categories,
    globalSettings,
    selectedTheme,
    visibleThemes,
    // actions spread
    ...actions,
    // theme convenience
    handleThemeSelect: (theme: Theme) => setThemeId(theme.id),
  };
}
