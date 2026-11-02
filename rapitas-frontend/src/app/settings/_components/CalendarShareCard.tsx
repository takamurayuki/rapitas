'use client';
/**
 * CalendarShareCard
 *
 * Who may see my month calendar, and the two buttons that change it (#1270).
 *
 * Lives in personal settings rather than on the calendar page: granting is a
 * standing decision about my own data, which is what this page is for, while
 * the calendar page only needs to switch between the calendars I can already
 * see.
 *
 * Deliberately says what sharing exposes. "Share my calendar" is a sentence
 * people read as more than it is — this shares schedule events, read-only,
 * and no tasks.
 */
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserRound, Loader2, X } from 'lucide-react';
import { useCalendarShares, type GrantFailure } from '@/feature/calendar/hooks';

/** What the last grant attempt did, for the one line under the field. */
type AddState = { kind: 'idle' } | { kind: 'adding' } | { kind: 'failed'; reason: GrantFailure };

export default function CalendarShareCard() {
  const t = useTranslations('settings.calendarShare');
  const { sharedByMe, loading, failed, grant, revoke } = useCalendarShares();
  const [identifier, setIdentifier] = useState('');
  const [add, setAdd] = useState<AddState>({ kind: 'idle' });

  const onAdd = async () => {
    const trimmed = identifier.trim();
    if (!trimmed) return;
    setAdd({ kind: 'adding' });
    const result = await grant(trimmed);
    if (result.ok) {
      setIdentifier('');
      setAdd({ kind: 'idle' });
      return;
    }
    setAdd({ kind: 'failed', reason: result.reason });
  };

  return (
    <div
      id="calendar-share"
      className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900"
    >
      <div className="mb-1 flex items-center gap-2">
        <UserRound className="h-4 w-4 text-zinc-500" />
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{t('title')}</h2>
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">{t('description')}</p>

      <div className="flex gap-2">
        <input
          value={identifier}
          onChange={(e) => {
            setIdentifier(e.target.value);
            // Any edit invalidates the previous verdict; leaving "no such
            // person" beside a corrected name is the same lie as a failure
            // looking fine.
            setAdd({ kind: 'idle' });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void onAdd();
          }}
          placeholder={t('placeholder')}
          aria-label={t('placeholder')}
          className="flex-1 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
        />
        <button
          onClick={() => void onAdd()}
          disabled={add.kind === 'adding' || identifier.trim() === ''}
          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:opacity-50"
        >
          {add.kind === 'adding' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('add')}
        </button>
      </div>

      {add.kind === 'failed' && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          {t(
            add.reason === 'unknown_person'
              ? 'unknownPerson'
              : add.reason === 'self'
                ? 'self'
                : add.reason === 'no_session'
                  ? 'noSession'
                  : 'addFailed',
          )}
        </p>
      )}

      <div className="mt-4">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
        ) : failed ? (
          <p className="text-xs text-red-600 dark:text-red-400">{t('loadFailed')}</p>
        ) : sharedByMe.length === 0 ? (
          <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('nobody')}</p>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {sharedByMe.map((person) => (
              <li key={person.workspaceId} className="flex items-center justify-between py-2">
                <span className="min-w-0 text-sm text-zinc-800 dark:text-zinc-100">
                  <span className="truncate font-medium">{person.username}</span>
                  {person.email && (
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {person.email}
                    </span>
                  )}
                </span>
                <button
                  onClick={() => void revoke(person.workspaceId)}
                  title={t('revoke')}
                  aria-label={t('revokeFor', { name: person.username })}
                  className="shrink-0 rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-500 dark:hover:bg-zinc-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
