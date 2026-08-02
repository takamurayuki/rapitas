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
  const [decks, setDecks] = useState<DeckOption[] | null>(null);
  const [deckId, setDeckId] = useState<number | null>(null);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [status, setStatus] = useState<CaptureStatus>('idle');
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
      const res = await fetch(`${API_BASE_URL}/vocab/decks/${deckId}/cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ front: front.trim(), back: back.trim() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Stay open: clear and return to the front field for the next word.
      savingRef.current = false;
      setStatus('saved');
      setFront('');
      setBack('');
      frontRef.current?.focus();
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    } catch {
      // Keep the text so the word pair is never lost on a failed save.
      savingRef.current = false;
      setStatus('error');
    }
  }, [deckId, front, back, savingRef]);

  const inputCls =
    'flex-1 min-w-0 rounded-lg bg-zinc-50 dark:bg-zinc-800/60 px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 focus:outline-none';

  if (decks && decks.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('vocabNoDecks')}
      </div>
    );
  }

  return (
    <>
      {/* Deck picker — pill chips like the mode switcher, not a pulldown. */}
      <div
        role="radiogroup"
        aria-label={t('deckAria')}
        className="flex flex-wrap items-center gap-1 border-b border-zinc-200 dark:border-zinc-700 pb-2"
      >
        {(decks ?? []).map((d) => (
          <button
            key={d.id}
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
                ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {d.name}
          </button>
        ))}
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
      <CaptureStatusBar status={status} />
    </>
  );
}
