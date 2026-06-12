'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Settings, Globe, ExternalLink } from 'lucide-react';
import { useLocaleStore } from '@/stores/locale-store';
import { locales, type Locale } from '@/i18n/config';
import { EXTERNAL_BROWSER_KEY } from '@/utils/tauri';
import BackupCard from '../_components/BackupCard';
import RecentErrorsCard from '../_components/RecentErrorsCard';
import Link from 'next/link';

const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
};

/** Preset external-link browsers. Empty value = OS default. */
const BROWSER_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '' }, // label filled from i18n at render
  { value: 'chrome', label: 'Google Chrome' },
  { value: 'msedge', label: 'Microsoft Edge' },
  { value: 'firefox', label: 'Firefox' },
];

export default function GeneralSettingsPage() {
  const t = useTranslations('settings');
  const { locale, setLocale } = useLocaleStore();

  // External-link browser preference (persisted in localStorage; read by
  // openExternalUrl). Loaded on mount to avoid SSR hydration mismatch.
  const [browser, setBrowser] = useState('');
  useEffect(() => {
    setBrowser(localStorage.getItem(EXTERNAL_BROWSER_KEY) || '');
  }, []);
  const updateBrowser = (value: string) => {
    setBrowser(value);
    if (value) localStorage.setItem(EXTERNAL_BROWSER_KEY, value);
    else localStorage.removeItem(EXTERNAL_BROWSER_KEY);
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2.5 bg-violet-100 dark:bg-violet-900/30 rounded-xl">
          <Settings className="w-6 h-6 text-violet-600 dark:text-violet-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {t('generalTitle')}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">{t('generalDescription')}</p>
        </div>
      </div>

      <div className="space-y-6">
        {/* External link browser */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <ExternalLink className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {t('externalBrowserTitle')}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('externalBrowserDescription')}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <select
              value={browser}
              onChange={(e) => updateBrowser(e.target.value)}
              className="w-full sm:w-72 rounded-lg border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-800 px-3 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-violet-400"
            >
              {BROWSER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.value === '' ? t('externalBrowserDefault') : opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Language */}
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Globe className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {t('languageTitle')}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('languageDescription')}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {locales.map((loc) => (
                <button
                  key={loc}
                  onClick={() => setLocale(loc)}
                  className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                    locale === loc
                      ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                      : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                  }`}
                >
                  {locale === loc && (
                    <div className="absolute top-2 right-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                    </div>
                  )}
                  <Globe
                    className={`w-6 h-6 mb-2 ${
                      locale === loc
                        ? 'text-violet-600 dark:text-violet-400'
                        : 'text-zinc-400 dark:text-zinc-500'
                    }`}
                  />
                  <h3
                    className={`font-medium text-sm ${
                      locale === loc
                        ? 'text-violet-700 dark:text-violet-300'
                        : 'text-zinc-900 dark:text-zinc-100'
                    }`}
                  >
                    {LOCALE_LABELS[loc]}
                  </h3>
                  <p
                    className={`text-xs mt-1 ${
                      locale === loc
                        ? 'text-violet-500 dark:text-violet-400'
                        : 'text-zinc-500 dark:text-zinc-400'
                    }`}
                  >
                    {loc.toUpperCase()}
                  </p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <BackupCard />
        <RecentErrorsCard />

        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
          <h2 className="mb-1 text-base font-semibold text-zinc-900 dark:text-zinc-100">
            セットアップ確認
          </h2>
          <p className="mb-3 text-xs text-zinc-500 dark:text-zinc-400">
            データベースと AI プロバイダーの状態を再確認します。
          </p>
          <Link
            href="/setup"
            className="inline-flex items-center gap-1 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            セットアップ画面を開く
          </Link>
        </div>
      </div>
    </div>
  );
}
