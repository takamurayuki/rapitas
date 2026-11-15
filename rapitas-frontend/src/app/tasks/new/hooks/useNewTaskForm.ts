'use client';
// useNewTaskForm
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Priority, Theme, WorkflowMode } from '@/types';
import { useTaskFormData } from './useTaskFormData';
import { useTaskFormActions } from './useTaskFormActions';
import type { DeliverableOption } from '@/feature/tasks/components/spec';

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
  // 本人が確かめること・範囲外・成果物 (#1555). PR is what a development task hands over.
  const [userAcceptanceChecks, setUserAcceptanceChecks] = useState('');
  const [outOfScope, setOutOfScope] = useState('');
  const [deliverable, setDeliverable] = useState<DeliverableOption>('pr');

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
      userAcceptanceChecks,
      outOfScope,
      deliverable,
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
    userAcceptanceChecks,
    setUserAcceptanceChecks,
    outOfScope,
    setOutOfScope,
    deliverable,
    setDeliverable,
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
