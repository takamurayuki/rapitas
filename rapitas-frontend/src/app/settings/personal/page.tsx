'use client';
/**
 * PersonalSettingsPage
 *
 * The settings that are about the person rather than the machine: what ラピ
 * is told about them before she plans anything.
 *
 * Split out of /settings/general for #1275. It was one card among the UI
 * language, the external browser, backups and recent errors — and it is now
 * stored on the account's own settings row, so it belongs on a page of its
 * own, behind the sign-in, with the account's data.
 *
 * Not the place for account credentials: there is no password-change
 * endpoint yet.
 */
import { useTranslations } from 'next-intl';
import { UserPen } from 'lucide-react';
import { requireAuth } from '@/contexts/AuthContext';
import RapiProfileCard from '../_components/RapiProfileCard';
import CalendarShareCard from '../_components/CalendarShareCard';

function PersonalSettingsPage() {
  const t = useTranslations('settings');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
          <UserPen className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {t('personal.title')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('personal.subtitle')}</p>
        </div>
      </div>

      <div className="space-y-6">
        <RapiProfileCard />
        <CalendarShareCard />
      </div>
    </div>
  );
}

// NOTE: requireAuth wraps the page because what it holds is the signed-in
// account's own data, not the install's.
export default requireAuth(PersonalSettingsPage);
