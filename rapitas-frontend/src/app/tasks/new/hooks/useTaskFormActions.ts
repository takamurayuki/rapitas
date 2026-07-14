'use client';
// useTaskFormActions
import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import type { Priority, TaskTemplate, UserSettings } from '@/types';
import type { ApplyTemplateFields } from '@/feature/tasks/components/dialog/ApplyTemplateDialog';
import { useToast } from '@/components/ui/toast/ToastContainer';
import { API_BASE_URL } from '@/utils/api';
import { createLogger } from '@/lib/logger';
import type { PendingSubtask } from './useNewTaskForm';
import { useTaskSubmit, type TaskPayloadValues } from './useTaskSubmit';

const logger = createLogger('useTaskFormActions');
const API_BASE = API_BASE_URL;

interface FieldSetters {
  setTitle: (v: string) => void;
  setDescription: (v: string) => void;
  setPriority: (v: Priority) => void;
  setEstimatedHours: (v: string) => void;
  setSelectedLabelIds: (v: number[]) => void;
  setGoals: (v: string) => void;
  setConstraints: (v: string) => void;
  setAcceptanceCriteria: (v: string) => void;
}

/**
 * Provides all action handlers for the new-task form except submit.
 * Also owns the subtask list state so SubtaskForm and SubtaskList can share it.
 *
 * @param values - Snapshot of current form field values / 現在フォーム値のスナップショット
 * @param setters - Setters for fields the actions need to update / 更新が必要なフィールドのセッター
 * @returns Action handlers, subtask state, and UI flags.
 */
export function useTaskFormActions(
  values: TaskPayloadValues & {
    description: string;
    globalSettings: UserSettings | null;
  },
  setters: FieldSetters,
) {
  const { showToast } = useToast();
  const t = useTranslations('task');

  const [isGeneratingTitle, setIsGeneratingTitle] = useState(false);
  const [isDerivingSpec, setIsDerivingSpec] = useState(false);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [appliedTemplate, setAppliedTemplate] = useState<TaskTemplate | null>(null);

  // ── Subtask list ──────────────────────────────────────────────────────────
  const [subtasks, setSubtasks] = useState<PendingSubtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');
  const [newSubtaskDescription, setNewSubtaskDescription] = useState('');
  const [newSubtaskPriority, setNewSubtaskPriority] = useState<Priority>('medium');
  const [newSubtaskLabels, setNewSubtaskLabels] = useState('');
  const [newSubtaskEstimatedHours, setNewSubtaskEstimatedHours] = useState('');

  // ── Submission ────────────────────────────────────────────────────────────
  // NOTE: getValues/getSubtasks use refs so useTaskSubmit always reads current state
  // without needing to be re-created when values change.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const subtasksRef = useRef(subtasks);
  subtasksRef.current = subtasks;

  const { isSubmitting, handleSubmit, handleSubmitWithTitle } = useTaskSubmit(
    () => valuesRef.current,
    () => subtasksRef.current,
  );

  // ── Subtask management ────────────────────────────────────────────────────

  const resetSubtaskForm = () => {
    setNewSubtaskTitle('');
    setNewSubtaskDescription('');
    setNewSubtaskPriority('medium');
    setNewSubtaskLabels('');
    setNewSubtaskEstimatedHours('');
  };

  const addSubtask = () => {
    if (!newSubtaskTitle.trim()) return;
    const labelsArray = newSubtaskLabels
      .split(',')
      .map((l) => l.trim())
      .filter(Boolean);
    const hours = parseFloat(newSubtaskEstimatedHours);
    setSubtasks([
      ...subtasks,
      {
        id: Date.now().toString(),
        title: newSubtaskTitle.trim(),
        ...(newSubtaskDescription.trim() && {
          description: newSubtaskDescription.trim(),
        }),
        priority: newSubtaskPriority,
        ...(labelsArray.length > 0 && { labels: labelsArray }),
        ...(hours && !isNaN(hours) && { estimatedHours: hours }),
      },
    ]);
    resetSubtaskForm();
  };

  /**
   * Removes a pending subtask by its temporary ID.
   *
   * @param id - Temporary subtask ID / 一時的なサブタスクID
   */
  const removeSubtask = (id: string) => {
    setSubtasks(subtasks.filter((st) => st.id !== id));
  };

  // ── Template handling ─────────────────────────────────────────────────────

  /**
   * Applies a template's data to the controlled form fields.
   *
   * @param template - Template to apply / 適用するテンプレート
   * @param fields - Which fields to apply (all when omitted) / 適用するフィールドの選択
   */
  const handleApplyTemplate = (template: TaskTemplate, fields?: ApplyTemplateFields) => {
    const f: ApplyTemplateFields = fields ?? {
      title: true,
      description: true,
      priority: true,
      estimatedHours: true,
      subtasks: true,
    };
    setAppliedTemplate(template);
    const data = template.templateData;
    if (f.title && data.title) setters.setTitle(data.title);
    if (f.description && data.description) setters.setDescription(data.description);
    if (f.priority && data.priority) setters.setPriority(data.priority);
    if (f.estimatedHours && data.estimatedHours) {
      setters.setEstimatedHours(data.estimatedHours.toString());
    }
    if (f.subtasks && data.subtasks && Array.isArray(data.subtasks)) {
      setSubtasks(
        data.subtasks.map((st, idx) => ({
          id: `template-${idx}-${Date.now()}`,
          title: st.title,
          description: st.description,
          estimatedHours: st.estimatedHours,
        })),
      );
    }
  };

  // ── Title generation ──────────────────────────────────────────────────────

  /**
   * Calls the title-generation API and optionally auto-submits the form.
   *
   * @param fromAutoGenerate - True when triggered by the debounced timer / タイマーからの呼び出しの場合true
   */
  const handleGenerateTitle = async (fromAutoGenerate = false) => {
    if (!values.description.trim() || isGeneratingTitle) return;
    setIsGeneratingTitle(true);
    try {
      const res = await fetch(`${API_BASE}/developer-mode/generate-title`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: values.description.trim() }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || t('titleGenerateFailed'));
      }
      const data = await res.json();
      if (data.title) {
        setters.setTitle(data.title);
        if (!fromAutoGenerate) {
          showToast(t('titleGeneratedSuccess'), 'success');
        }
        // NOTE: Auto-create after title generation (only when called from auto-generate).
        if (fromAutoGenerate && values.globalSettings?.autoCreateAfterTitleGeneration) {
          logger.debug('[useTaskFormActions] Auto-creating task with title:', data.title);
          setTimeout(() => {
            handleSubmitWithTitle(data.title);
          }, 100); // NOTE: Short delay to ensure state update completes before submission.
        }
      }
    } catch (e) {
      logger.error(e);
      showToast(e instanceof Error ? e.message : t('titleGenerateFailed'), 'error');
    } finally {
      setIsGeneratingTitle(false);
    }
  };

  const autoGenerateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (autoGenerateTimerRef.current) {
      clearTimeout(autoGenerateTimerRef.current);
      autoGenerateTimerRef.current = null;
    }
    if (
      !values.globalSettings?.autoGenerateTitle ||
      !values.description.trim() ||
      values.title.trim() ||
      isGeneratingTitle
    ) {
      return;
    }
    const delaySec = values.globalSettings?.autoGenerateTitleDelay ?? 3;
    autoGenerateTimerRef.current = setTimeout(() => {
      handleGenerateTitle(true);
    }, delaySec * 1000);
    return () => {
      if (autoGenerateTimerRef.current) {
        clearTimeout(autoGenerateTimerRef.current);
        autoGenerateTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    values.description,
    values.globalSettings?.autoGenerateTitle,
    values.globalSettings?.autoGenerateTitleDelay,
  ]);

  // ── Spec derivation (AI) ──────────────────────────────────────────────────

  /**
   * Derives structured goals / constraints / acceptance criteria from the free-text
   * description via AI, then fills the corresponding form fields.
   */
  const deriveSpec = async () => {
    if (!values.description.trim() || isDerivingSpec) return;
    setIsDerivingSpec(true);
    try {
      const res = await fetch(`${API_BASE}/tasks/derive-spec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: values.description.trim() }),
      });
      if (!res.ok) throw new Error(t('specDeriveFailed'));
      const data = await res.json();
      const join = (a: unknown): string => (Array.isArray(a) ? a.filter(Boolean).join('\n') : '');
      setters.setGoals(join(data.goals));
      setters.setConstraints(join(data.constraints));
      setters.setAcceptanceCriteria(join(data.acceptanceCriteria));
      showToast(t('specDerived'), 'success');
    } catch (e) {
      logger.error(e);
      showToast(e instanceof Error ? e.message : t('specDeriveFailed'), 'error');
    } finally {
      setIsDerivingSpec(false);
    }
  };

  // ── Suggestion handling ───────────────────────────────────────────────────

  /**
   * Applies a task suggestion to the form fields.
   *
   * @param suggestion - Suggestion payload / 提案データ
   */
  const handleApplySuggestion = (suggestion: {
    title: string;
    priority: Priority;
    estimatedHours: string;
    description: string;
    labelIds: number[];
  }) => {
    setters.setTitle(suggestion.title);
    setters.setPriority(suggestion.priority);
    if (suggestion.estimatedHours) setters.setEstimatedHours(suggestion.estimatedHours);
    if (suggestion.description) setters.setDescription(suggestion.description);
    if (suggestion.labelIds.length > 0) setters.setSelectedLabelIds(suggestion.labelIds);
    showToast(t('suggestionApplied'), 'success');
  };

  return {
    isSubmitting,
    isGeneratingTitle,
    showTemplateDialog,
    setShowTemplateDialog,
    appliedTemplate,
    subtasks,
    newSubtaskTitle,
    setNewSubtaskTitle,
    newSubtaskDescription,
    setNewSubtaskDescription,
    newSubtaskPriority,
    setNewSubtaskPriority,
    newSubtaskLabels,
    setNewSubtaskLabels,
    newSubtaskEstimatedHours,
    setNewSubtaskEstimatedHours,
    addSubtask,
    removeSubtask,
    resetSubtaskForm,
    handleGenerateTitle,
    deriveSpec,
    isDerivingSpec,
    handleSubmit,
    handleSubmitWithTitle,
    handleApplyTemplate,
    handleApplySuggestion,
  };
}
