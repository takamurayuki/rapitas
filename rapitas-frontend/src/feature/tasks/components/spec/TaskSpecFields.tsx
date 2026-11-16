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
 *
 * Laid out in three groups: what the task is for (goals, deliverable), when
 * it is done (the two kinds of completion condition, side by side), and its
 * scope and preconditions, which are optional and folded while empty.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronDown } from 'lucide-react';
import { HelpTip } from '@/components/ui/help-tip/HelpTip';
import type { DeliverableOption, SpecErrors } from './task-spec-validation';
import { SpecTextField, type SpecField } from './SpecTextField';
import { DeliverablePicker } from './DeliverablePicker';

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

const GROUP_TITLE = 'text-xs font-semibold text-zinc-700 dark:text-zinc-200';

/**
 * @param props - Spec values, setters and the required state / 仕様の値と必須の状態
 */
export function TaskSpecFields(props: TaskSpecFieldsProps) {
  const t = useTranslations('task');
  const { isDevelopment, specIssues, idPrefix = 'spec' } = props;
  const field = (
    key: string,
    labelKey: string,
    value: string,
    set: (v: string) => void,
    extra: Partial<SpecField> = {},
  ): SpecField => ({
    key,
    label: t(labelKey),
    placeholder: t(`${labelKey}Placeholder`),
    value,
    set,
    ...extra,
  });

  const goals = field('goals', 'specGoals', props.goals, props.setGoals, {
    required: true,
    error: specIssues.goals,
  });
  // The two kinds of completion condition, under one heading (#1557): one is
  // required, either will do, so the requirement and its error belong to the group.
  const completion = [
    field('acceptance', 'specAcceptance', props.acceptanceCriteria, props.setAcceptanceCriteria),
    field(
      'userChecks',
      'specUserChecks',
      props.userAcceptanceChecks,
      props.setUserAcceptanceChecks,
    ),
  ];
  const scope = [
    field('outOfScope', 'specOutOfScope', props.outOfScope, props.setOutOfScope),
    field('constraints', 'specConstraints', props.constraints, props.setConstraints),
    field(
      'startConditions',
      'specStartConditions',
      props.startConditions,
      props.setStartConditions,
    ),
  ];
  const scopeFilled = scope.some((f) => f.value.trim() !== '');
  const [scopeOpen, setScopeOpen] = useState(scopeFilled);
  const showScope = scopeOpen || scopeFilled;

  const completionError = specIssues.completionCriteria;
  const completionErrorId = `${idPrefix}-completion-error`;
  const goalsErrorId = goals.error ? `${idPrefix}-goals-error` : undefined;

  return (
    <div className="space-y-5">
      {isDevelopment && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('specRequiredHint')}</p>
      )}

      <section className="space-y-3" aria-label={t('specPurpose')}>
        <h4 className={GROUP_TITLE}>{t('specPurpose')}</h4>
        <SpecTextField
          field={goals}
          idPrefix={idPrefix}
          showRequired={isDevelopment}
          invalid={!!goals.error}
          describedBy={goalsErrorId}
        />
        <DeliverablePicker
          value={props.deliverable}
          onChange={props.setDeliverable}
          idPrefix={idPrefix}
        />
      </section>

      <fieldset data-spec-field="completion" className="space-y-2">
        <legend className={`flex items-center ${GROUP_TITLE}`}>
          {t('specCompletion')}
          {isDevelopment && (
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          )}
          <HelpTip label={t('specCompletionHelp')}>{t('specCompletionNote')}</HelpTip>
        </legend>
        <div className="grid gap-3 md:grid-cols-2">
          {completion.map((f) => (
            <SpecTextField
              key={f.key}
              field={f}
              idPrefix={idPrefix}
              showRequired={false}
              invalid={!!completionError}
              describedBy={completionError ? completionErrorId : undefined}
            />
          ))}
        </div>
        {completionError && (
          <p id={completionErrorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
            {t(completionError)}
          </p>
        )}
      </fieldset>

      <section className="space-y-3">
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setScopeOpen((o) => !o)}
            aria-expanded={showScope}
            disabled={scopeFilled}
            className={`flex items-center gap-1 ${GROUP_TITLE} disabled:cursor-default`}
          >
            <ChevronDown
              className={`w-3.5 h-3.5 transition-transform ${showScope ? '' : '-rotate-90'}`}
              aria-hidden="true"
            />
            {t('specScope')}
            <span className="ml-1 font-normal text-zinc-500 dark:text-zinc-400">
              {t('specOptional')}
            </span>
          </button>
          <HelpTip label={t('specScopeHelp')}>{t('specScopeNote')}</HelpTip>
        </div>
        {showScope &&
          scope.map((f) => (
            <SpecTextField
              key={f.key}
              field={f}
              idPrefix={idPrefix}
              showRequired={false}
              invalid={false}
            />
          ))}
      </section>
    </div>
  );
}
