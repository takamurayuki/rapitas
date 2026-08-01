'use client';

/**
 * SenseRelations
 *
 * Visual map of one sense's word relationships: synonyms cluster on the left
 * of a semantic axis, the word sits in the middle, antonyms on the right —
 * so "same direction vs opposite pole" is readable at a glance. Chips expand
 * on hover/tap to show the nuance note and example.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Equal, ArrowRightLeft } from 'lucide-react';
import type { VocabRelatedWord, VocabSense } from './vocab.types';

interface SenseRelationsProps {
  word: string;
  sense: VocabSense;
}

interface RelatedChipProps {
  item: VocabRelatedWord;
  kind: 'synonym' | 'antonym';
}

/** One expandable related-word chip. */
function RelatedChip({ item, kind }: RelatedChipProps) {
  const [open, setOpen] = useState(false);
  const hasBody = !!(item.nuance || item.example);
  const color =
    kind === 'synonym'
      ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300';

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => hasBody && setOpen((v) => !v)}
        className={`w-full rounded-lg border px-2.5 py-1 text-left text-sm font-medium ${color} ${
          hasBody ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        {item.word}
        {item.nuance && !open && (
          <span className="ml-1.5 truncate text-xs font-normal opacity-70">{item.nuance}</span>
        )}
      </button>
      {open && (
        <div className="mt-1 rounded-lg bg-zinc-50 px-2.5 py-1.5 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-400">
          {item.nuance && <p className="font-medium">{item.nuance}</p>}
          {item.example && <p className="mt-0.5 italic">{item.example}</p>}
          {item.exampleJa && <p className="mt-0.5">{item.exampleJa}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * Render the synonym / word / antonym axis for one sense.
 *
 * @param props - The word and one parsed sense. / 単語と語義。
 */
export function SenseRelations({ word, sense }: SenseRelationsProps) {
  const t = useTranslations('vocabulary.details');
  if (sense.synonyms.length === 0 && sense.antonyms.length === 0) return null;

  return (
    <div className="mt-2 flex items-stretch gap-2">
      {/* Synonyms — same direction */}
      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400">
          <Equal className="h-3 w-3" aria-hidden="true" />
          {t('synonyms')}
        </div>
        <div className="flex flex-col gap-1">
          {sense.synonyms.length > 0 ? (
            sense.synonyms.map((s, i) => (
              <RelatedChip key={`${s.word}-${i}`} item={s} kind="synonym" />
            ))
          ) : (
            <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>
          )}
        </div>
      </div>

      {/* The word on its semantic axis: ≒ on the synonym side, ⇔ toward antonyms */}
      <div className="flex w-28 shrink-0 flex-col items-center justify-center gap-1">
        <div className="flex w-full items-center gap-1">
          <div className="h-px flex-1 bg-sky-300 dark:bg-sky-700" />
          <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-semibold text-white">
            {word}
          </span>
          <div className="h-px flex-1 border-t border-dashed border-amber-400 bg-transparent dark:border-amber-600" />
        </div>
        <span className="text-[10px] text-zinc-400 dark:text-zinc-500">{t('axisHint')}</span>
      </div>

      {/* Antonyms — opposite pole */}
      <div className="flex-1 min-w-0">
        <div className="mb-1 flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-wide text-amber-600 dark:text-amber-400">
          <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
          {t('antonyms')}
        </div>
        <div className="flex flex-col gap-1">
          {sense.antonyms.length > 0 ? (
            sense.antonyms.map((a, i) => (
              <RelatedChip key={`${a.word}-${i}`} item={a} kind="antonym" />
            ))
          ) : (
            <span className="text-right text-xs text-zinc-400 dark:text-zinc-600">—</span>
          )}
        </div>
      </div>
    </div>
  );
}
