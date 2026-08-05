'use client';

/**
 * MemosPage
 *
 * List view for lightweight memos captured via the quick-capture popup (or the
 * add box here): filter tabs (未完了 / リマインダー / 完了), paginated list,
 * done toggle and delete. Reminders are delivered through the notification
 * bell by the backend scheduler.
 */
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { NotepadText } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import Pagination from '@/components/ui/pagination/Pagination';
import { useMemos } from './_components/use-memos';
import { MemoAddForm } from './_components/memo-add-form';
import { MemoRow } from './_components/memo-row';
import type { Memo, MemoFilter } from './_components/memo.types';

const FILTERS: MemoFilter[] = ['open', 'reminder', 'done'];

export default function MemosPage() {
  const t = useTranslations('memos');
  const vm = useMemos();
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const totalPages = Math.max(1, Math.ceil(vm.memos.length / itemsPerPage));
  const pageMemos = useMemo(
    () => vm.memos.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage),
    [vm.memos, currentPage, itemsPerPage],
  );

  // No confirm dialog by request — memos are tiny, low-stakes records.
  const handleDelete = async (memo: Memo) => {
    await vm.deleteMemo(memo.id);
  };

  const switchFilter = (f: MemoFilter) => {
    vm.setFilter(f);
    setCurrentPage(1);
  };

  const tabCls = (active: boolean) =>
    `rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300'
        : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`;

  return (
    <div className="h-[calc(100vh-4.2rem)] overflow-auto bg-background">
      <div className="mx-auto max-w-3xl px-3 sm:px-4 md:px-6 py-4">
        <div className="mb-4 flex items-center gap-2.5">
          <NotepadText className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('subtitle')}</p>
          </div>
        </div>

        <MemoAddForm onAdd={vm.addMemo} />

        <div className="mb-2 flex gap-1">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => switchFilter(f)} className={tabCls(vm.filter === f)}>
              {t(`filters.${f}`)}
            </button>
          ))}
        </div>

        {vm.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner size="md" />
          </div>
        ) : vm.memos.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('emptyState')}
          </p>
        ) : (
          <>
            <div>
              {pageMemos.map((memo) => (
                <MemoRow
                  key={memo.id}
                  memo={memo}
                  onToggleDone={vm.toggleDone}
                  onDelete={handleDelete}
                />
              ))}
            </div>
            <div className="mt-3">
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                itemsPerPage={itemsPerPage}
                onPageChange={setCurrentPage}
                onItemsPerPageChange={(n) => {
                  setItemsPerPage(n);
                  setCurrentPage(1);
                }}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
