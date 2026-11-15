/**
 * useTaskSpecEditor
 *
 * Edit state for a task's spec on the detail screen (#1555): the lists as
 * one item per line, the deliverable, and a save that sends the criteria
 * revision the screen was loaded with. A development-project task is not
 * saved without its goals and a completion criterion — the same rule the
 * intake gate holds it to before an agent starts. Not responsible for
 * drawing anything (`TaskSpecEditSection`).
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { Task } from '@/types';
import { API_BASE_URL } from '@/utils/api';
import { clearApiCache } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast/ToastContainer';
import {
  DELIVERABLE_OPTIONS,
  specErrors,
  toLines,
  type DeliverableOption,
  type SpecErrors,
} from './task-spec-validation';
import type { TaskSpecValues } from './TaskSpecFields';
import { parseCriteriaList } from '../detail/task-criteria.utils';

const asText = (stored: string | null | undefined) => parseCriteriaList(stored).join('\n');

const asDeliverable = (stored: string | null | undefined): DeliverableOption =>
  (DELIVERABLE_OPTIONS as readonly string[]).includes(stored ?? '')
    ? (stored as DeliverableOption)
    : 'pr';

/**
 * @param task - The task as loaded / 読み込んだタスク
 * @param isDevelopment - Whether its theme is a development project / 開発プロジェクトか
 * @param onSaved - Called after a successful save, to reload / 保存後の再読み込み
 * @returns Values, setters, edit state and the save action / 編集状態と保存
 */
export function useTaskSpecEditor(task: Task, isDevelopment: boolean, onSaved?: () => void) {
  const t = useTranslations('task');
  const { showToast } = useToast();
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [specIssues, setSpecIssues] = useState<SpecErrors>({});
  const [goals, setGoals] = useState('');
  const [outOfScope, setOutOfScope] = useState('');
  const [constraints, setConstraints] = useState('');
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('');
  const [userAcceptanceChecks, setUserAcceptanceChecks] = useState('');
  const [deliverable, setDeliverable] = useState<DeliverableOption>('pr');

  /** Start editing from what is stored now. */
  const begin = () => {
    setGoals(asText(task.goals));
    setOutOfScope(asText(task.outOfScope));
    setConstraints(asText(task.constraints));
    setAcceptanceCriteria(asText(task.acceptanceCriteria));
    setUserAcceptanceChecks(asText(task.userAcceptanceChecks));
    setDeliverable(asDeliverable(task.deliverable));
    setSpecIssues({});
    setEditing(true);
  };

  const save = async () => {
    const errors = specErrors({ goals, acceptanceCriteria, userAcceptanceChecks }, isDevelopment);
    setSpecIssues(errors);
    if (Object.keys(errors).length > 0) {
      showToast(t('specRequiredToast'), 'error');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goals: toLines(goals),
          constraints: toLines(constraints),
          acceptanceCriteria: toLines(acceptanceCriteria),
          userAcceptanceChecks: toLines(userAcceptanceChecks),
          outOfScope: toLines(outOfScope),
          deliverable,
          expectedCriteriaRevision: task.criteriaRevision,
        }),
      });
      if (!res.ok) {
        // The server says why in Japanese (changed since, under review, done …).
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        showToast(body?.error ?? t('specSaveFailed'), 'error');
        return;
      }
      clearApiCache(`/tasks/${task.id}`);
      setEditing(false);
      showToast(t('specSaved'), 'success');
      onSaved?.();
    } catch {
      showToast(t('specSaveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const values: TaskSpecValues = {
    goals,
    setGoals,
    outOfScope,
    setOutOfScope,
    constraints,
    setConstraints,
    acceptanceCriteria,
    setAcceptanceCriteria,
    userAcceptanceChecks,
    setUserAcceptanceChecks,
    deliverable,
    setDeliverable,
  };
  return { values, editing, saving, specIssues, begin, cancel: () => setEditing(false), save };
}
