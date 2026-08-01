/**
 * useVocabDeck
 *
 * Deck-detail view model: deck + cards, card CRUD, and the review session
 * (due queue fetch + grading round-trip).
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { VocabCard, VocabDeckDetail, VocabGrade } from './vocab.types';

/**
 * Provide deck detail state and handlers.
 *
 * @param deckId - Deck to load / 対象デッキID
 * @returns Deck state, card CRUD, and review-session controls. / デッキ状態・カード操作・復習セッション。
 */
export function useVocabDeck(deckId: number) {
  const t = useTranslations('vocabulary');
  const { showToast } = useToast();
  const [deck, setDeck] = useState<VocabDeckDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [reviewQueue, setReviewQueue] = useState<VocabCard[] | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);

  const fetchDeck = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/vocab/decks/${deckId}`);
      if (res.ok) setDeck((await res.json()) as VocabDeckDetail);
    } catch {
      /* non-critical */
    } finally {
      setIsLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    fetchDeck();
  }, [fetchDeck]);

  const addCard = useCallback(
    async (front: string, back: string, note: string) => {
      if (!front.trim() || !back.trim()) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/decks/${deckId}/cards`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            front: front.trim(),
            back: back.trim(),
            note: note.trim() || null,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchDeck();
        return true;
      } catch {
        showToast(t('messages.createFailed'), 'error');
        return false;
      }
    },
    [deckId, fetchDeck, showToast, t],
  );

  /** Generic PATCH of any card fields (used by the dictionary detail editor). */
  const updateCardFields = useCallback(
    async (id: number, payload: Record<string, string | null>) => {
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/cards/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchDeck();
        return true;
      } catch {
        showToast(t('messages.updateFailed'), 'error');
        return false;
      }
    },
    [fetchDeck, showToast, t],
  );

  const updateCard = useCallback(
    (id: number, front: string, back: string, note: string) =>
      updateCardFields(id, { front: front.trim(), back: back.trim(), note: note.trim() || null }),
    [updateCardFields],
  );

  const deleteCard = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/cards/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setDeck((prev) =>
          prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== id) } : prev,
        );
      } catch {
        showToast(t('messages.deleteFailed'), 'error');
      }
    },
    [showToast, t],
  );

  /** Fetch the due queue and enter review mode (null queue = not reviewing). */
  const startReview = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/vocab/decks/${deckId}/review`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { cards: VocabCard[] };
      setReviewQueue(data.cards);
      setReviewedCount(0);
    } catch {
      showToast(t('messages.reviewFailed'), 'error');
    }
  }, [deckId, showToast, t]);

  /** Grade the current card; 'again' re-queues it at the back of this session. */
  const gradeCard = useCallback(
    async (card: VocabCard, grade: VocabGrade) => {
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/cards/${card.id}/review`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grade }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch {
        showToast(t('messages.reviewFailed'), 'error');
        return;
      }
      setReviewedCount((n) => n + 1);
      setReviewQueue((queue) => {
        if (!queue) return queue;
        const rest = queue.slice(1);
        // A forgotten card comes back within this session, matching its ~10min due.
        return grade === 'again' ? [...rest, card] : rest;
      });
    },
    [showToast, t],
  );

  const endReview = useCallback(() => {
    setReviewQueue(null);
    fetchDeck();
  }, [fetchDeck]);

  return {
    deck,
    isLoading,
    addCard,
    updateCard,
    updateCardFields,
    deleteCard,
    reviewQueue,
    reviewedCount,
    startReview,
    gradeCard,
    endReview,
  };
}
