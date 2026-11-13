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
import { requireAuth } from '@/contexts/AuthContext';
import { RapiProfileCard } from '../../components/rapi-profile';
import CalendarShareCard from '../../components/CalendarShareCard';

function PersonalSettingsPage() {
  const t = useTranslations('settings');

  return (
    <div>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">{t('personal.subtitle')}</p>

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
