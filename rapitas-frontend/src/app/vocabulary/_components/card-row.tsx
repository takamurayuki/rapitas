'use client';

/**
 * VocabCardRow
 *
 * One card in the deck detail list, with inline editing of front/back/note.
 */
import { useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Pencil, Trash2, Check, X, BookOpenText, ChevronDown, ChevronUp } from 'lucide-react';
import type { VocabCard } from './vocab.types';
import { parseSenses } from './vocab.types';
import { CardDetailEditor } from './card-detail-editor';
import { SenseRelations } from './sense-relations';

interface CardRowProps {
  card: VocabCard;
  onUpdate: (id: number, front: string, back: string, note: string) => Promise<boolean>;
  onUpdateFields: (id: number, payload: Record<string, string | null>) => Promise<boolean>;
  onDelete: (id: number) => void;
}

/**
 * Render a single card row.
 *
 * @param props - Card data and CRUD callbacks. / カードと操作コールバック。
 */
export function VocabCardRow({ card, onUpdate, onUpdateFields, onDelete }: CardRowProps) {
  const t = useTranslations('vocabulary');
  const format = useFormatter();
  const [isEditing, setIsEditing] = useState(false);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [note, setNote] = useState(card.note ?? '');

  const senses = parseSenses(card.details);
  const isDue = new Date(card.dueAt).getTime() <= Date.now();

  const save = async () => {
    if (await onUpdate(card.id, front, back, note)) setIsEditing(false);
  };

  const inputCls =
    'w-full rounded border border-zinc-200 bg-white px-2 py-1 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';

  if (isEditing) {
    return (
      <div className="flex flex-col gap-1.5 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
        <div className="flex items-stretch gap-1.5">
          <input
            value={front}
            onChange={(e) => setFront(e.target.value)}
            aria-label={t('frontPlaceholder')}
            className={`${inputCls} w-2/5 self-start`}
          />
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={2}
            aria-label={t('backPlaceholder')}
            className={`${inputCls} flex-1 resize-none`}
          />
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          aria-label={t('notePlaceholder')}
          placeholder={t('notePlaceholder')}
          className={inputCls}
        />
        <div className="flex justify-end gap-1.5">
          <button
            onClick={() => setIsEditing(false)}
            aria-label={t('cancel')}
            className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-4 w-4" />
          </button>
          <button
            onClick={save}
            disabled={!front.trim() || !back.trim()}
            aria-label={t('save')}
            className="rounded p-1.5 text-green-600 hover:bg-zinc-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            <Check className="h-4 w-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-zinc-100 py-2.5 last:border-b-0 dark:border-zinc-800/60">
      <div className="group flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{card.front}</span>
            {card.pronunciation && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{card.pronunciation}</span>
            )}
            {card.partOfSpeech && (
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {card.partOfSpeech}
              </span>
            )}
            {/* Meanings are one-per-line — keep the line breaks visible. */}
            <span className="whitespace-pre-line text-sm text-zinc-600 dark:text-zinc-400">
              {card.back}
            </span>
          </div>
          {card.note && (
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">{card.note}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`text-[11px] ${
              isDue
                ? 'rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'text-zinc-400 dark:text-zinc-500'
            }`}
          >
            {isDue
              ? t('dueNow')
              : t('nextReview', {
                  date: format.dateTime(new Date(card.dueAt), { dateStyle: 'medium' }),
                })}
          </span>
          <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              onClick={() => setIsDetailOpen(true)}
              aria-label={t('details.editorAria')}
              title={t('details.editorAria')}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-indigo-600 dark:hover:bg-zinc-800 dark:hover:text-indigo-400"
            >
              <BookOpenText className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setIsEditing(true)}
              aria-label={t('edit')}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => onDelete(card.id)}
              aria-label={t('delete')}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          {senses.length > 0 && (
            <button
              onClick={() => setIsExpanded((v) => !v)}
              aria-label={t('details.toggleAria')}
              aria-expanded={isExpanded}
              className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Dictionary detail — senses with examples and the relation axis */}
      {isExpanded && senses.length > 0 && (
        <div className="mt-2 flex flex-col gap-3 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900/40">
          {card.syllables && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{card.syllables}</p>
          )}
          {senses.map((sense, i) => (
            <div key={i}>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                <span className="mr-1.5 rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                  {i + 1}
                </span>
                {sense.meaning}
              </p>
              {sense.example && (
                <p className="mt-1 pl-6 text-sm italic text-zinc-600 dark:text-zinc-400">
                  {sense.example}
                </p>
              )}
              {sense.exampleJa && (
                <p className="pl-6 text-xs text-zinc-500 dark:text-zinc-500">{sense.exampleJa}</p>
              )}
              <SenseRelations word={card.front} sense={sense} />
            </div>
          ))}
        </div>
      )}

      {isDetailOpen && (
        <CardDetailEditor
          card={card}
          onSave={onUpdateFields}
          onClose={() => setIsDetailOpen(false)}
        />
      )}
    </div>
  );
}
