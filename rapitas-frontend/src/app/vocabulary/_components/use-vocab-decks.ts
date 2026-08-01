/**
 * useVocabDecks
 *
 * Deck-list view model: fetch, create, rename, delete.
 */
'use client';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { API_BASE_URL } from '@/utils/api';
import { useToast } from '@/components/ui/toast/ToastContainer';
import type { VocabDeckSummary } from './vocab.types';

/**
 * Provide the deck list with CRUD handlers.
 *
 * @returns Deck list state and mutation handlers. / デッキ一覧の状態と操作。
 */
export function useVocabDecks() {
  const t = useTranslations('vocabulary');
  const { showToast } = useToast();
  const [decks, setDecks] = useState<VocabDeckSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDecks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/vocab/decks`);
      if (res.ok) setDecks((await res.json()) as VocabDeckSummary[]);
    } catch {
      /* non-critical — list stays as-is */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDecks();
  }, [fetchDecks]);

  const createDeck = useCallback(
    async (name: string, description: string) => {
      if (!name.trim()) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/decks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), description: description.trim() || null }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchDecks();
        return true;
      } catch {
        showToast(t('messages.createFailed'), 'error');
        return false;
      }
    },
    [fetchDecks, showToast, t],
  );

  const renameDeck = useCallback(
    async (id: number, name: string) => {
      if (!name.trim()) return;
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/decks/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim() }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await fetchDecks();
      } catch {
        showToast(t('messages.updateFailed'), 'error');
      }
    },
    [fetchDecks, showToast, t],
  );

  const deleteDeck = useCallback(
    async (id: number) => {
      try {
        const res = await fetch(`${API_BASE_URL}/vocab/decks/${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setDecks((prev) => prev.filter((d) => d.id !== id));
      } catch {
        showToast(t('messages.deleteFailed'), 'error');
      }
    },
    [showToast, t],
  );

  return { decks, isLoading, createDeck, renameDeck, deleteDeck };
}
