'use client';
/**
 * RapiProfileCard
 *
 * Where the user says who they are, once, so ラピ stops asking.
 *
 * The roadmap interview opens by asking about your situation and your
 * constraints, and asks again on the next roadmap. Asked for 2026-10-22:
 * write it here and every plan is drafted against it instead.
 *
 * Stored through PATCH /settings like the other file-backed settings; the
 * backend keeps it in RAPITAS_DATA_DIR rather than a Prisma column, so this
 * needed no schema change.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { UserPen, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '@/utils/api';

/** Mirrors MAX_RAPI_PROFILE_LENGTH in the backend's rapi-profile-store. */
const MAX_LENGTH = 1200;

/** What a save attempt last did; drives the one line under the button. */
type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

export default function RapiProfileCard() {
  const t = useTranslations();
  const [value, setValue] = useState('');
  /** What the server last confirmed, so an unchanged save is a no-op. */
  const [stored, setStored] = useState('');
  const [loading, setLoading] = useState(true);
  const [save, setSave] = useState<SaveState>('idle');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/settings`);
        const body = (await res.json()) as { rapiProfile?: string | null };
        if (cancelled) return;
        const current = body?.rapiProfile ?? '';
        setValue(current);
        setStored(current);
      } catch {
        // An unreachable backend leaves the box empty rather than blocking
        // the rest of the settings page.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = useCallback(async () => {
    if (value === stored) return;
    setSave('saving');
    try {
      const res = await fetch(`${API_BASE_URL}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rapiProfile: value }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStored(value);
      setSave('saved');
    } catch {
      // Looking saved when it is not is how a profile silently stops being
      // the one ラピ is planning against.
      setSave('failed');
    }
  }, [value, stored]);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-1 flex items-center gap-2">
        <UserPen className="h-4 w-4 text-zinc-500" />
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {t('settings.rapiProfile.title')}
        </h2>
      </div>
      <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
        {t('settings.rapiProfile.description')}
      </p>

      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
      ) : (
        <>
          <textarea
            value={value}
            maxLength={MAX_LENGTH}
            rows={6}
            onChange={(e) => {
              setValue(e.target.value);
              // Any edit invalidates the previous verdict: leaving "saved"
              // on screen beside changed text is the same lie as a failed
              // save looking fine.
              setSave('idle');
            }}
            placeholder={t('settings.rapiProfile.placeholder')}
            className="w-full resize-y rounded-lg border border-zinc-200 bg-white p-2 text-sm text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={save === 'saving' || value === stored}
              className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('settings.rapiProfile.save')}
            </button>
            {save === 'saved' && (
              <span className="text-xs text-green-600 dark:text-green-400">
                {t('settings.rapiProfile.saved')}
              </span>
            )}
            {save === 'failed' && (
              <span className="text-xs text-red-600 dark:text-red-400">
                {t('settings.rapiProfile.saveFailed')}
              </span>
            )}
            {/* The budget is real: this text rides in front of every roadmap
                request, so it is shown before the box silently stops taking
                characters. */}
            <span className="ml-auto text-[11px] tabular-nums text-zinc-400">
              {value.length}/{MAX_LENGTH}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
