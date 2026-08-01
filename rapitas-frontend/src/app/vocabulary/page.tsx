'use client';

/**
 * VocabularyPage
 *
 * Deck list for the vocabulary book (単語帳): create/rename/delete decks and
 * see how many cards are due for review in each. Card editing and the review
 * session live on the deck detail page.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { WalletCards, Plus, Pencil, Trash2, Check, X } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useConfirmDialog } from '@/components/ui/dialog/ConfirmDialogProvider';
import { useVocabDecks } from './_components/use-vocab-decks';

export default function VocabularyPage() {
  const t = useTranslations('vocabulary');
  const confirm = useConfirmDialog();
  const { decks, isLoading, createDeck, renameDeck, deleteDeck } = useVocabDecks();

  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleCreate = async () => {
    if (await createDeck(newName, newDescription)) {
      setNewName('');
      setNewDescription('');
      setShowCreate(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (await confirm(t('deleteConfirm', { name }))) await deleteDeck(id);
  };

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-4xl px-3 sm:px-4 md:px-6 py-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <WalletCards className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                {t('title')}
              </h1>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
            </div>
          </div>
          <button
            onClick={() => setShowCreate((v) => !v)}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            {t('addDeck')}
          </button>
        </div>

        {showCreate && (
          <div className="mb-4 rounded-lg bg-zinc-50 dark:bg-zinc-900/40 p-4 flex flex-col gap-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              aria-label={t('deckNamePlaceholder')}
              placeholder={t('deckNamePlaceholder')}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <input
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              aria-label={t('deckDescriptionPlaceholder')}
              placeholder={t('deckDescriptionPlaceholder')}
              className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-lg px-3 py-1.5 text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              >
                {t('cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="rounded-lg bg-indigo-600 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              >
                {t('create')}
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-16">
            <Spinner size="md" />
          </div>
        ) : decks.length === 0 ? (
          <div className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-400">
            <WalletCards className="mx-auto mb-3 h-10 w-10 opacity-40" />
            {t('emptyState')}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {decks.map((deck) => (
              <div
                key={deck.id}
                className="group rounded-lg border border-zinc-200 bg-white p-4 transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-indigo-700"
              >
                <div className="flex items-start justify-between gap-2">
                  {renamingId === deck.id ? (
                    <div className="flex flex-1 items-center gap-1.5">
                      <input
                        autoFocus
                        value={renameValue}
                        aria-label={t('rename')}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            await renameDeck(deck.id, renameValue);
                            setRenamingId(null);
                          } else if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <button
                        onClick={async () => {
                          await renameDeck(deck.id, renameValue);
                          setRenamingId(null);
                        }}
                        aria-label={t('save')}
                        className="p-1 text-green-600 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setRenamingId(null)}
                        aria-label={t('cancel')}
                        className="p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <Link href={`/vocabulary/${deck.id}`} className="flex-1 min-w-0">
                      <h2 className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100">
                        {deck.name}
                      </h2>
                      {deck.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                          {deck.description}
                        </p>
                      )}
                    </Link>
                  )}
                  <div className="flex shrink-0 gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={() => {
                        setRenamingId(deck.id);
                        setRenameValue(deck.name);
                      }}
                      aria-label={t('rename')}
                      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(deck.id, deck.name)}
                      aria-label={t('delete')}
                      className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {t('cardCount', { count: deck.cardCount })}
                  </span>
                  {deck.dueCount > 0 && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                      {t('dueCount', { count: deck.dueCount })}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
