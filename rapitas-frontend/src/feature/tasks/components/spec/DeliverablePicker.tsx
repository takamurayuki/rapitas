'use client';
/**
 * DeliverablePicker
 *
 * The task's deliverable as visible choices, in place of a dropdown that hid
 * the other options; what each one means is behind the ? beside the label.
 * Not responsible for which deliverables exist (`task-spec-validation.ts`).
 */
import { useTranslations } from 'next-intl';
import { HelpTip } from '@/components/ui/help-tip/HelpTip';
import { DELIVERABLE_OPTIONS, type DeliverableOption } from './task-spec-validation';

/**
 * @param props.value - Chosen deliverable / 選んだ成果物
 * @param props.onChange - Called with the new choice / 選択時に呼ぶ
 * @param props.idPrefix - Prefix for the element ids / 要素IDの接頭辞
 */
export function DeliverablePicker({
  value,
  onChange,
  idPrefix,
}: {
  value: DeliverableOption;
  onChange: (v: DeliverableOption) => void;
  idPrefix: string;
}) {
  const t = useTranslations('task');
  const labelId = `${idPrefix}-deliverable-label`;
  return (
    <div data-spec-field="deliverable">
      <div className="mb-1 flex items-center">
        <p id={labelId} className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          {t('specDeliverable')}
        </p>
        <HelpTip label={t('specDeliverableHelp')}>
          <span className="block space-y-1">
            {DELIVERABLE_OPTIONS.map((d) => (
              <span key={d} className="block">
                <span className="font-medium">{t(`deliverable.${d}`)}</span>
                {': '}
                {t(`deliverableHint.${d}`)}
              </span>
            ))}
          </span>
        </HelpTip>
      </div>
      <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
        {DELIVERABLE_OPTIONS.map((d) => {
          const selected = d === value;
          return (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(d)}
              className={`px-3 py-1 rounded-md text-xs border transition-colors ${
                selected
                  ? 'border-indigo-500/70 bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
              }`}
            >
              {t(`deliverable.${d}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
