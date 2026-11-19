'use client';
/**
 * NoteMigrationDiffList
 *
 * The notes that differ between this PC and the server, each with what
 * differs, both update times, and the three choices of design §5.3 step 3
 * (PC version / server version / keep both). The newer side starts selected.
 * Not responsible for sending the choices — the parent's `onApply` does.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import type { DiffChoice } from '@/stores/note/note-migration-record';
import type { DiffField, MigrationDiff } from './note-migration-plan';

interface Props {
  diffs: MigrationDiff[];
  onApply: (choices: Record<string, DiffChoice>) => void;
}

const FIELD_KEY: Record<DiffField, string> = {
  title: 'fieldTitle',
  content: 'fieldContent',
  tags: 'fieldTags',
  docType: 'fieldDocType',
};

const CHOICES: { value: DiffChoice; key: string }[] = [
  { value: 'pc', key: 'choicePc' },
  { value: 'server', key: 'choiceServer' },
  { value: 'both', key: 'choiceBoth' },
];

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * The difference list with a choice per note.
 *
 * @param diffs - The differing notes / 差異のあるノート
 * @param onApply - Called with the choice per id / ID ごとの選択で呼ばれる
 */
export default function NoteMigrationDiffList({ diffs, onApply }: Props) {
  const t = useTranslations('notes.migration');
  const [choices, setChoices] = useState<Record<string, DiffChoice>>(() =>
    Object.fromEntries(diffs.map((d) => [d.id, d.defaultChoice])),
  );

  return (
    <div className="mt-3 space-y-2" data-testid="note-migration-diffs">
      <p className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
        {t('diffTitle', { count: diffs.length })}
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('diffHint')}</p>
      <ul className="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
        {diffs.map((diff) => {
          const choice = choices[diff.id] ?? diff.defaultChoice;
          return (
            <li
              key={diff.id}
              className="px-3 py-2.5"
              data-testid={`note-migration-diff-${diff.id}`}
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-100">
                  {diff.local.title || diff.server.title || t('untitled')}
                </span>
                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t('differs')}：
                  {diff.fields.map((f) => (
                    <span
                      key={f}
                      className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
                    >
                      {t(FIELD_KEY[f])}
                    </span>
                  ))}
                </span>
                <span className="text-[11px] text-zinc-400 dark:text-zinc-500">
                  {t('pcUpdated', { date: formatDate(diff.localUpdatedAt) })}
                  {t('serverUpdated', { date: formatDate(diff.server.updatedAt) })}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label={diff.local.title || diff.id}
                className="mt-1.5 flex flex-wrap gap-1.5"
              >
                {CHOICES.map(({ value, key }) => (
                  <label
                    key={value}
                    className={`flex cursor-pointer items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${
                      choice === value
                        ? 'border-indigo-400 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-200'
                        : 'border-zinc-200 text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800'
                    }`}
                  >
                    <input
                      type="radio"
                      name={`note-migration-${diff.id}`}
                      value={value}
                      checked={choice === value}
                      onChange={() => setChoices((c) => ({ ...c, [diff.id]: value }))}
                      className="sr-only"
                    />
                    {t(key)}
                  </label>
                ))}
              </div>
              {choice === 'both' && (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                  {t('bothHint', { id: `${diff.id}-pc` })}
                </p>
              )}
              {diff.localIsLegacyHtml && choice !== 'server' && (
                <p className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{t('htmlHint')}</p>
              )}
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => onApply(choices)}
          className="rounded-lg bg-indigo-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
        >
          {t('apply')}
        </button>
      </div>
    </div>
  );
}
