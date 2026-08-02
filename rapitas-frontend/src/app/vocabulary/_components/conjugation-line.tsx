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
  const entries = CONJUGATION_KEYS.filter((k) => conjugations[k]);
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      {entries.map((key) => (
        <span key={key} className="inline-flex items-baseline gap-1 text-sm">
          <span className="text-[10px] text-zinc-500 dark:text-zinc-400">
            {t(`conjugationLabels.${key}`)}
          </span>
          <span className="font-medium text-zinc-800 dark:text-zinc-200">{conjugations[key]}</span>
        </span>
      ))}
    </div>
  );
}
