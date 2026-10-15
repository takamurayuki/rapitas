'use client';

/**
 * CardDetailEditor
 *
 * Dictionary-style structured editor for one card: syllables, pronunciation,
 * part of speech, and per-sense meaning/example with synonyms and antonyms
 * (each with a nuance note and example). Saves everything through the card
 * PATCH endpoint; senses serialize into the card's `details` JSON.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, BookOpenText } from 'lucide-react';
import { Modal } from '@/components/ui/modal/Modal';
import type { VocabCard, VocabConjugations, VocabRelatedWord, VocabSense } from './vocab.types';
import { CONJUGATION_KEYS, parseCardDetails } from './vocab.types';

interface CardDetailEditorProps {
  card: VocabCard;
  onSave: (id: number, payload: Record<string, string | null>) => Promise<boolean>;
  onClose: () => void;
}

const emptyRelated = (): VocabRelatedWord => ({ word: '', nuance: '', example: '', exampleJa: '' });
const emptySense = (): VocabSense => ({
  meaning: '',
  example: '',
  exampleJa: '',
  synonyms: [],
  antonyms: [],
});

/**
 * Render the structured card editor modal.
 *
 * @param props - Card, save handler, and close callback. / カード・保存・クローズ。
 */
export function CardDetailEditor({ card, onSave, onClose }: CardDetailEditorProps) {
  const t = useTranslations('vocabulary.details');
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [syllables, setSyllables] = useState(card.syllables ?? '');
  const [pronunciation, setPronunciation] = useState(card.pronunciation ?? '');
  const [partOfSpeech, setPartOfSpeech] = useState(card.partOfSpeech ?? '');
  const [note, setNote] = useState(card.note ?? '');
  const parsed = parseCardDetails(card.details);
  const [senses, setSenses] = useState<VocabSense[]>(parsed.senses);
  const [conjugations, setConjugations] = useState<VocabConjugations>(parsed.conjugations ?? {});
  const [isSaving, setIsSaving] = useState(false);

  const patchSense = (i: number, patch: Partial<VocabSense>) =>
    setSenses((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));

  const patchRelated = (
    i: number,
    kind: 'synonyms' | 'antonyms',
    j: number,
    patch: Partial<VocabRelatedWord>,
  ) =>
    patchSense(i, {
      [kind]: senses[i][kind].map((r, idx) => (idx === j ? { ...r, ...patch } : r)),
    } as Partial<VocabSense>);

  const save = async () => {
    if (!front.trim() || !back.trim() || isSaving) return;
    setIsSaving(true);
    const cleaned = senses
      .map((s) => ({
        ...s,
        synonyms: s.synonyms.filter((r) => r.word.trim()),
        antonyms: s.antonyms.filter((r) => r.word.trim()),
      }))
      .filter((s) => s.meaning.trim());
    const conj: VocabConjugations = {};
    for (const key of CONJUGATION_KEYS) {
      const e = conjugations[key];
      if (e?.form?.trim()) {
        conj[key] = {
          form: e.form.trim(),
          ...(e.example?.trim() && { example: e.example.trim() }),
          ...(e.note?.trim() && { note: e.note.trim() }),
        };
      }
    }
    const hasConj = Object.keys(conj).length > 0;
    const ok = await onSave(card.id, {
      front: front.trim(),
      back: back.trim(),
      note: note.trim() || null,
      syllables: syllables.trim() || null,
      pronunciation: pronunciation.trim() || null,
      partOfSpeech: partOfSpeech.trim() || null,
      details:
        cleaned.length > 0 || hasConj
          ? JSON.stringify({ senses: cleaned, ...(hasConj && { conjugations: conj }) })
          : null,
    });
    setIsSaving(false);
    if (ok) onClose();
  };

  const inputCls =
    'w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100';
  const sectionLabel =
    'text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400';

  const relatedEditor = (i: number, kind: 'synonyms' | 'antonyms') => (
    <div className="flex-1 min-w-0">
      <div className="mb-1 flex items-center justify-between">
        <span
          className={`text-[11px] font-semibold ${
            kind === 'synonyms'
              ? 'text-sky-600 dark:text-sky-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {t(kind === 'synonyms' ? 'synonyms' : 'antonyms')}
        </span>
        <button
          type="button"
          onClick={() =>
            patchSense(i, { [kind]: [...senses[i][kind], emptyRelated()] } as Partial<VocabSense>)
          }
          aria-label={t('addRelated')}
          className="rounded p-0.5 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5">
        {senses[i][kind].map((r, j) => (
          <div key={j} className="rounded-lg bg-zinc-50 p-1.5 dark:bg-zinc-800/60">
            <div className="flex items-center gap-1">
              <input
                value={r.word}
                onChange={(e) => patchRelated(i, kind, j, { word: e.target.value })}
                placeholder={t('relatedWordPlaceholder')}
                aria-label={t('relatedWordPlaceholder')}
                className={`${inputCls} font-medium`}
              />
              <button
                type="button"
                onClick={() =>
                  patchSense(i, {
                    [kind]: senses[i][kind].filter((_, idx) => idx !== j),
                  } as Partial<VocabSense>)
                }
                aria-label={t('remove')}
                className="rounded p-1 text-zinc-400 hover:text-red-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <input
              value={r.nuance ?? ''}
              onChange={(e) => patchRelated(i, kind, j, { nuance: e.target.value })}
              placeholder={t('nuancePlaceholder')}
              aria-label={t('nuancePlaceholder')}
              className={`${inputCls} mt-1`}
            />
            <input
              value={r.example ?? ''}
              onChange={(e) => patchRelated(i, kind, j, { example: e.target.value })}
              placeholder={t('examplePlaceholder')}
              aria-label={t('examplePlaceholder')}
              className={`${inputCls} mt-1`}
            />
            <input
              value={r.exampleJa ?? ''}
              onChange={(e) => patchRelated(i, kind, j, { exampleJa: e.target.value })}
              placeholder={t('exampleJaPlaceholder')}
              aria-label={t('exampleJaPlaceholder')}
              className={`${inputCls} mt-1`}
            />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={t('editorTitle', { word: card.front })}
      icon={<BookOpenText className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />}
      maxWidthClass="max-w-3xl"
      footer={
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg px-3.5 py-2 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            {t('cancel')}
          </button>
          <button
            onClick={save}
            disabled={!front.trim() || !back.trim() || isSaving}
            className="rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
          >
            {t('save')}
          </button>
        </div>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        {/* Word basics */}
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>{t('front')}</span>
            <input value={front} onChange={(e) => setFront(e.target.value)} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>{t('syllables')}</span>
            <input
              value={syllables}
              onChange={(e) => setSyllables(e.target.value)}
              placeholder="con・found"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>{t('pronunciation')}</span>
            <input
              value={pronunciation}
              onChange={(e) => setPronunciation(e.target.value)}
              placeholder="/kənˈfaʊnd/"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={sectionLabel}>{t('partOfSpeech')}</span>
            <input
              value={partOfSpeech}
              onChange={(e) => setPartOfSpeech(e.target.value)}
              placeholder={t('partOfSpeechPlaceholder')}
              className={inputCls}
            />
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className={sectionLabel}>{t('back')}</span>
          <textarea
            value={back}
            onChange={(e) => setBack(e.target.value)}
            rows={2}
            className={`${inputCls} resize-none`}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={sectionLabel}>{t('note')}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
        </label>

        {/* Conjugations (語形変化) — each form with its own example / note */}
        <div className="flex flex-col gap-1.5">
          <span className={sectionLabel}>{t('conjugations')}</span>
          {CONJUGATION_KEYS.map((key) => (
            <div key={key} className="grid grid-cols-[5.5rem_1fr_1.4fr_1.4fr] items-center gap-1.5">
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                {t(`conjugationLabels.${key}`)}
              </span>
              <input
                value={conjugations[key]?.form ?? ''}
                onChange={(e) =>
                  setConjugations((prev) => ({
                    ...prev,
                    [key]: { ...prev[key], form: e.target.value },
                  }))
                }
                aria-label={t(`conjugationLabels.${key}`)}
                className={inputCls}
              />
              <input
                value={conjugations[key]?.example ?? ''}
                onChange={(e) =>
                  setConjugations((prev) => ({
                    ...prev,
                    [key]: { form: prev[key]?.form ?? '', ...prev[key], example: e.target.value },
                  }))
                }
                placeholder={t('conjExample')}
                aria-label={t('conjExample')}
                className={inputCls}
              />
              <input
                value={conjugations[key]?.note ?? ''}
                onChange={(e) =>
                  setConjugations((prev) => ({
                    ...prev,
                    [key]: { form: prev[key]?.form ?? '', ...prev[key], note: e.target.value },
                  }))
                }
                placeholder={t('conjNote')}
                aria-label={t('conjNote')}
                className={inputCls}
              />
            </div>
          ))}
        </div>

        {/* Senses */}
        <div className="flex items-center justify-between">
          <span className={sectionLabel}>{t('senses')}</span>
          <button
            type="button"
            onClick={() => setSenses((prev) => [...prev, emptySense()])}
            className="flex items-center gap-1 rounded-lg border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('addSense')}
          </button>
        </div>
        {senses.map((sense, i) => (
          <div key={i} className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
            <div className="mb-2 flex items-center gap-2">
              <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-semibold text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                {i + 1}
              </span>
              <input
                value={sense.meaning}
                onChange={(e) => patchSense(i, { meaning: e.target.value })}
                placeholder={t('meaningPlaceholder')}
                aria-label={t('meaningPlaceholder')}
                className={`${inputCls} font-medium`}
              />
              <button
                type="button"
                onClick={() => setSenses((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label={t('remove')}
                className="rounded p-1.5 text-zinc-400 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <input
                value={sense.example ?? ''}
                onChange={(e) => patchSense(i, { example: e.target.value })}
                placeholder={t('examplePlaceholder')}
                aria-label={t('examplePlaceholder')}
                className={inputCls}
              />
              <input
                value={sense.exampleJa ?? ''}
                onChange={(e) => patchSense(i, { exampleJa: e.target.value })}
                placeholder={t('exampleJaPlaceholder')}
                aria-label={t('exampleJaPlaceholder')}
                className={inputCls}
              />
            </div>
            <div className="mt-2 flex gap-3">
              {relatedEditor(i, 'synonyms')}
              {relatedEditor(i, 'antonyms')}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
