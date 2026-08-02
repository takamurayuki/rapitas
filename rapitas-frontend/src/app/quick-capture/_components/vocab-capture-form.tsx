'use client';

/**
 * VocabCaptureForm
 *
 * Vocabulary mode of the quick-capture popup: pick a deck (last used is
 * remembered), then front → Enter → back → Enter saves and clears for the
 * next word. Notes/example sentences are edited later on the deck page —
 * this form optimizes for burst entry.
 */
import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Pencil } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';
import { CaptureStatusBar } from './capture-status-bar';
import type { CaptureStatus } from './capture-window';

const LAST_DECK_KEY = 'rapitas-quick-capture-deck';

interface DeckOption {
  id: number;
  name: string;
}

interface VocabCaptureFormProps {
  /** Shared with the page's blur-to-hide guard. / blur時非表示の抑止フラグ。 */
  savingRef: MutableRefObject<boolean>;
}

/**
 * Render the vocabulary capture fields.
 *
 * @param props - Shared saving flag. / 保存中フラグ。
 */
export function VocabCaptureForm({ savingRef }: VocabCaptureFormProps) {
  const t = useTranslations('quickCapture');
  const tDetails = useTranslations('vocabulary.details');
  const [decks, setDecks] = useState<DeckOption[] | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  // Optional inflections (語形変化); the front doubles as the base form.
  const [conj, setConj] = useState({ third: '', ing: '', past: '', pastParticiple: '' });
  const [status, setStatus] = useState<CaptureStatus>('idle');
  // Inline deck management (create / rename) without leaving the popup.
  const [deckDraft, setDeckDraft] = useState<{ mode: 'add' | 'rename'; value: string } | null>(
    null,
  );
  const frontRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/decks`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()) as DeckOption[];
        setDecks(list);
        const stored = Number(localStorage.getItem(LAST_DECK_KEY));
        const initial = list.find((d) => d.id === stored) ?? list[0];
        setDeckId(initial ? initial.id : null);
      } catch {
        setDecks([]);
      }
    })();
  }, []);

  useEffect(() => {
    frontRef.current?.focus();
  }, [decks]);

  const submit = useCallback(async () => {
    if (!deckId || !front.trim() || !back.trim() || savingRef.current) return;
    savingRef.current = true;
    setStatus('saving');
    try {
      // Any filled inflection ships the table, with the front as its base form.
      const filled = Object.entries(conj).filter(([, v]) => v.trim());
      const details =
        filled.length > 0
          ? JSON.stringify({
              senses: [],
              conjugations: {
                base: front.trim(),
                ...Object.fromEntries(filled.map(([k, v]) => [k, v.trim()])),
              },
            })
          : undefined;
      const res = await fetch(`${API_BASE_URL}/vocab/decks/${deckId}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front: front.trim(),
          back: back.trim(),
          ...(details && { details }),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Stay open: clear and return to the front field for the next word.
      savingRef.current = false;
      setStatus('saved');
      setFront('');
      setBack('');
      setConj({ third: '', ing: '', past: '', pastParticiple: '' });
      frontRef.current?.focus();
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the word pair is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [deckId, front, back, conj, savingRef]);

  const inputCls =
    'flex-1 min-w-0 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none';

  /** Create or rename a deck straight from the popup, then refresh the list. */
  const commitDeckDraft = async () => {
    if (!deckDraft || !deckDraft.value.trim() || savingRef.current) return;
    savingRef.current = true;
    try {
      const isAdd = deckDraft.mode === 'add';
      const res = await fetch(
        isAdd ? `${API_BASE_URL}/vocab/decks` : `${API_BASE_URL}/vocab/decks/${deckId}`,
        {
          method: isAdd ? 'POST' : 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: deckDraft.value.trim() }),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const saved = (await res.json()) as DeckOption;
      const listRes = await fetch(`${API_BASE_URL}/vocab/decks`);
      if (listRes.ok) setDecks((await listRes.json()) as DeckOption[]);
      if (isAdd) {
        setDeckId(saved.id);
        localStorage.setItem(LAST_DECK_KEY, String(saved.id));
      }
      setDeckDraft(null);
      frontRef.current?.focus();
    } catch {
      setStatus('error');
    } finally {
      savingRef.current = false;
    }
  };

  if (decks && decks.length === 0 && deckDraft?.mode !== 'add') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
        {t('vocabNoDecks')}
        <button
          type="button"
          onClick={() => setDeckDraft({ mode: 'add', value: '' })}
          className="flex items-center gap-1 rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"
        >
          <Plus className="h-3.5 w-3.5" />
          {t('addDeck')}
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Deck picker — pill chips like the mode switcher, not a pulldown.
          The active chip carries a rename pencil; + appends a new deck. */}
      <div
        role="radiogroup"
        aria-label={t('deckAria')}
        className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 pb-2"
      >
        {(decks ?? []).map((d) =>
          deckDraft?.mode === 'rename' && deckId === d.id ? (
            <input
              key={d.id}
              autoFocus
              value={deckDraft.value}
              onChange={(e) => setDeckDraft({ mode: 'rename', value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commitDeckDraft();
                } else if (e.key === 'Escape') {
                  e.stopPropagation();
                  setDeckDraft(null);
                }
              }}
              aria-label={t('renameDeckAria')}
              className="w-32 rounded-md bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-900 focus:outline-none dark:bg-zinc-800/60 dark:text-zinc-100"
            />
          ) : (
            <span key={d.id} className="group/deck relative inline-flex items-center">
              <button
                type="button"
                role="radio"
                aria-checked={deckId === d.id}
                onClick={() => {
                  setDeckId(d.id);
                  localStorage.setItem(LAST_DECK_KEY, String(d.id));
                  frontRef.current?.focus();
                }}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  deckId === d.id
                    ? 'bg-indigo-50 pr-6 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                    : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                }`}
              >
                {d.name}
              </button>
              {deckId === d.id && (
                <button
                  type="button"
                  onClick={() => setDeckDraft({ mode: 'rename', value: d.name })}
                  aria-label={t('renameDeckAria')}
                  title={t('renameDeckAria')}
                  className="absolute right-1.5 text-indigo-400 hover:text-indigo-600 dark:text-indigo-500 dark:hover:text-indigo-300"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              )}
            </span>
          ),
        )}
        {deckDraft?.mode === 'add' ? (
          <input
            autoFocus
            value={deckDraft.value}
            onChange={(e) => setDeckDraft({ mode: 'add', value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void commitDeckDraft();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                setDeckDraft(null);
              }
            }}
            placeholder={t('newDeckPlaceholder')}
            aria-label={t('newDeckPlaceholder')}
            className="w-32 rounded-md bg-zinc-50 px-2 py-1 text-xs text-zinc-900 focus:outline-none dark:bg-zinc-800/60 dark:text-zinc-100"
          />
        ) : (
          <button
            type="button"
            onClick={() => setDeckDraft({ mode: 'add', value: '' })}
            aria-label={t('addDeck')}
            title={t('addDeck')}
            className="rounded-md p-1 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {/* Front is a single word — keep it narrow; the back gets the room since
          one word often carries several meanings (one per line, Shift+Enter). */}
      <div className="flex flex-1 items-stretch gap-2 min-h-0">
        <input
          ref={frontRef}
          type="text"
          value={front}
          onChange={(e) => setFront(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              backRef.current?.focus();
            }
          }}
          placeholder={t('vocabFrontPlaceholder')}
          aria-label={t('vocabFrontPlaceholder')}
          className={`${inputCls} w-2/5 flex-none self-start`}
        />
        <textarea
          ref={backRef}
          value={back}
          onChange={(e) => setBack(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder={t('vocabBackPlaceholder')}
          aria-label={t('vocabBackPlaceholder')}
          className={`${inputCls} h-full resize-none`}
        />
      </div>
      {/* Optional inflections in one compact row (Enter saves from any). */}
      <div className="flex items-center gap-1.5">
        {(['third', 'ing', 'past', 'pastParticiple'] as const).map((key) => (
          <input
            key={key}
            type="text"
            value={conj[key]}
            onChange={(e) => setConj((prev) => ({ ...prev, [key]: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder={tDetails(`conjugationLabels.${key}`)}
            aria-label={tDetails(`conjugationLabels.${key}`)}
            className={`${inputCls} px-2 py-1.5 text-xs`}
          />
        ))}
      </div>
      <CaptureStatusBar status={status} />
    </>
  );
}
