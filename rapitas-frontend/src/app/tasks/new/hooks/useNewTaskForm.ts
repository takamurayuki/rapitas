'use client';
// useNewTaskForm
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Priority, Theme, WorkflowMode } from '@/types';
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
  // Structured spec (one item per line); folded into description on submit.
  const [goals, setGoals] = useState('');
  const [constraints, setConstraints] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');

  // ── Remote data + derived values ──────────────────────────────────────────
  const { themes, categories, globalSettings, selectedTheme, visibleThemes } = useTaskFormData({
    themeId,
    setThemeId,
  });

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
      goals,
      constraints,
      acceptanceCriteria,
      selectedTheme,
      globalSettings,
    },
    {
      setTitle,
      setDescription,
      setPriority,
      setEstimatedHours,
      setSelectedLabelIds,
      setGoals,
      setConstraints,
      setAcceptanceCriteria,
    },
  );

  return {
    // translations
    t,
    tc,
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
    goals,
    setGoals,
    constraints,
    setConstraints,
    acceptanceCriteria,
    setAcceptanceCriteria,
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
