'use client';
/**
 * SpecTextField
 *
 * One labelled list field of a task's spec (one item per line). It starts at
 * two lines and grows with what is written, so seven empty fields no longer
 * fill the screen. Not responsible for which fields exist or their rule.
 */
import { useTranslations } from 'next-intl';

/** One spec field as {@link TaskSpecFields} describes it. */
export interface SpecField {
  key: string;
  label: string;
  /** Example of what to write / 書き方の例 */
  placeholder: string;
  value: string;
  set: (v: string) => void;
  required?: boolean;
  error?: string;
}

const FIELD_CLASS =
  'w-full field-sizing-content min-h-[4.25rem] max-h-72 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-3 py-2 text-sm leading-relaxed border border-transparent outline-none resize-y focus:border-indigo-400/60 dark:focus:border-indigo-500/50 transition-colors placeholder:text-zinc-400 dark:placeholder:text-zinc-500';

/**
 * @param props.field - The field / 欄
 * @param props.idPrefix - Prefix for the element id / 要素IDの接頭辞
 * @param props.showRequired - Whether to mark it required / 必須の印を出すか
 * @param props.invalid - Whether to show it as invalid / 不備の表示をするか
 * @param props.describedBy - Id of the message describing the error / エラー文のID
 */
export function SpecTextField({
  field,
  idPrefix,
  showRequired,
  invalid,
  describedBy,
}: {
  field: SpecField;
  idPrefix: string;
  showRequired: boolean;
  invalid: boolean;
  describedBy?: string;
}) {
  const t = useTranslations('task');
  const id = `${idPrefix}-${field.key}`;
  return (
    <div data-spec-field={field.key}>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-zinc-600 dark:text-zinc-300 mb-1"
      >
        {field.label}
        {showRequired && field.required && (
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <textarea
        id={id}
        value={field.value}
        onChange={(e) => field.set(e.target.value)}
        placeholder={field.placeholder}
        aria-label={field.label}
        rows={2}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className={`${FIELD_CLASS} ${invalid ? 'border-red-400/70 dark:border-red-500/60' : ''}`}
      />
      {field.error && (
        <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">
          {t(field.error)}
        </p>
      )}
    </div>
  );
}
