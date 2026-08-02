'use client';

/**
 * ConjugationLine
 *
 * Compact inflection table (語形変化) rendered as label+form pairs on one
 * wrapping line — shared by the card list detail and the review flip side.
 */
import { useTranslations } from 'next-intl';
import { CONJUGATION_KEYS, type VocabConjugations } from './vocab.types';

interface ConjugationLineProps {
  conjugations: VocabConjugations;
}

/**
 * Render the inflections that are present, in canonical order.
 *
 * @param props - Parsed conjugation table. / 語形変化テーブル。
 */
export function ConjugationLine({ conjugations }: ConjugationLineProps) {
  const t = useTranslations('vocabulary.details');
  const keys = CONJUGATION_KEYS.filter((k) => conjugations[k]);
  if (keys.length === 0) return null;
  const hasBodies = keys.some((k) => conjugations[k]?.example || conjugations[k]?.note);

  return (
    <div
      className={
        hasBodies ? 'flex flex-col gap-1.5' : 'flex flex-wrap items-baseline gap-x-3 gap-y-1'
      }
    >
      {keys.map((key) => {
        const entry = conjugations[key]!;
        return (
          <div key={key} className={hasBodies ? '' : 'inline-flex items-baseline gap-1'}>
            <span className="inline-flex items-baseline gap-1 text-sm">
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
                {t(`conjugationLabels.${key}`)}
              </span>
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{entry.form}</span>
            </span>
            {entry.example && (
              <p className="pl-4 text-xs italic text-zinc-600 dark:text-zinc-400">
                {entry.example}
              </p>
            )}
            {entry.note && (
              <p className="pl-4 text-xs text-zinc-500 dark:text-zinc-500">{entry.note}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
