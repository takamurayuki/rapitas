'use client';
/**
 * TaskSpecFields
 *
 * The input fields of a task's spec — goals, out of scope, constraints,
 * acceptance criteria, what the person checks, and the deliverable (#1555) —
 * shared by the new-task form and the task detail's editor so both ask the
 * same way. In a development project the goals and a completion criterion are
 * marked required, and a refused save shows what is missing under the field.
 * Not responsible for the rule (`task-spec-validation.ts`) or for saving.
 */
import { useTranslations } from 'next-intl';
import {
  DELIVERABLE_OPTIONS,
  type DeliverableOption,
  type SpecErrors,
} from './task-spec-validation';

/** The spec values and setters, one item per line for the lists. */
export interface TaskSpecValues {
  goals: string;
  setGoals: (v: string) => void;
  outOfScope: string;
  setOutOfScope: (v: string) => void;
  /** 開始条件 in words (#1559) / 着手前に満たすこと */
  startConditions: string;
  setStartConditions: (v: string) => void;
  constraints: string;
  setConstraints: (v: string) => void;
  acceptanceCriteria: string;
  setAcceptanceCriteria: (v: string) => void;
  userAcceptanceChecks: string;
  setUserAcceptanceChecks: (v: string) => void;
  deliverable: DeliverableOption;
  setDeliverable: (v: DeliverableOption) => void;
}

/** Props of {@link TaskSpecFields}. */
export interface TaskSpecFieldsProps extends TaskSpecValues {
  /** Whether the task's theme is a development project / 開発プロジェクトか */
  isDevelopment: boolean;
  /** What a refused save found missing / 保存時に足りなかった項目 */
  specIssues: SpecErrors;
  /** Prefix for the element ids, unique per form on the page / 要素IDの接頭辞 */
  idPrefix?: string;
}

const FIELD_CLASS =
  'w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none resize-y focus:ring-2 focus:ring-indigo-500/20 transition-all placeholder:text-zinc-500 dark:placeholder:text-zinc-500';

/**
 * @param props - Spec values, setters and the required state / 仕様の値と必須の状態
 */
export function TaskSpecFields(props: TaskSpecFieldsProps) {
  const t = useTranslations('task');
  const { isDevelopment, specIssues, idPrefix = 'spec' } = props;

  type Field = {
    key: string;
    label: string;
    value: string;
    set: (v: string) => void;
    required?: boolean;
    error?: string;
  };
  const above: Field[] = [
    {
      key: 'goals',
      label: t('specGoals'),
      value: props.goals,
      set: props.setGoals,
      required: true,
      error: specIssues.goals,
    },
    {
      key: 'outOfScope',
      label: t('specOutOfScope'),
      value: props.outOfScope,
      set: props.setOutOfScope,
    },
    {
      key: 'startConditions',
      label: t('specStartConditions'),
      value: props.startConditions,
      set: props.setStartConditions,
    },
    {
      key: 'constraints',
      label: t('specConstraints'),
      value: props.constraints,
      set: props.setConstraints,
    },
  ];
  // The two kinds of completion condition, under one heading (#1557): one is
  // required, either will do, so the requirement and its error belong to the group.
  const completion: Field[] = [
    {
      key: 'acceptance',
      label: t('specAcceptance'),
      value: props.acceptanceCriteria,
      set: props.setAcceptanceCriteria,
    },
    {
      key: 'userChecks',
      label: t('specUserChecks'),
      value: props.userAcceptanceChecks,
      set: props.setUserAcceptanceChecks,
    },
  ];
  const completionError = specIssues.completionCriteria;
  const completionErrorId = `${idPrefix}-completion-error`;

  const renderField = (f: Field, invalid: boolean, describedBy?: string) => {
    const id = `${idPrefix}-${f.key}`;
    return (
      <div key={f.key} data-spec-field={f.key}>
        <label
          htmlFor={id}
          className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1"
        >
          {f.label}
          {isDevelopment && f.required && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
        <textarea
          id={id}
          value={f.value}
          onChange={(e) => f.set(e.target.value)}
          placeholder={t('specItemPlaceholder')}
          rows={3}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          className={`${FIELD_CLASS} ${invalid ? 'ring-2 ring-red-500/40' : ''}`}
        />
        {f.error && (
          <p
            id={`${id}-error`}
            role="alert"
            className="mt-1 text-xs text-red-600 dark:text-red-400"
          >
            {t(f.error)}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {isDevelopment && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('specRequiredHint')}</p>
      )}
      {above.map((f) =>
        renderField(f, !!f.error, f.error ? `${idPrefix}-${f.key}-error` : undefined),
      )}
      <fieldset data-spec-field="completion" className="space-y-2">
        <legend className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">
          {t('specCompletion')}
          {isDevelopment && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
        </legend>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('specCompletionNote')}</p>
        {completion.map((f) =>
          renderField(f, !!completionError, completionError ? completionErrorId : undefined),
        )}
        {completionError && (
          <p id={completionErrorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
            {t(completionError)}
          </p>
        )}
      </fieldset>
      <div data-spec-field="deliverable">
        <label
          htmlFor={`${idPrefix}-deliverable`}
          className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1"
        >
          {t('specDeliverable')}
        </label>
        <select
          id={`${idPrefix}-deliverable`}
          value={props.deliverable}
          onChange={(e) => props.setDeliverable(e.target.value as DeliverableOption)}
          className="w-full bg-zinc-50 dark:bg-zinc-800/50 rounded-xl px-4 py-2.5 text-sm border-none outline-none focus:ring-2 focus:ring-indigo-500/20"
        >
          {DELIVERABLE_OPTIONS.map((d) => (
            <option key={d} value={d}>
              {t(`deliverable.${d}`)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
