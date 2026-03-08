'use client';

import { Globe } from 'lucide-react';
import { useLocaleStore } from '@/stores/localeStore';
import type { Locale } from '@/i18n/config';

export default function LanguageSwitcher() {
  const { locale, setLocale } = useLocaleStore();

  const toggle = () => {
    const next: Locale = locale === 'ja' ? 'en' : 'ja';
    setLocale(next);
  };

  return (
    <button
      onClick={toggle}
      className="flex items-center gap-1.5 p-2 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      aria-label={locale === 'ja' ? 'Switch to English' : '日本語に切替'}
      title={locale === 'ja' ? 'Switch to English' : '日本語に切替'}
    >
      <Globe className="w-4 h-4" />
      <span className="text-xs font-medium uppercase">
        {locale === 'ja' ? 'EN' : 'JA'}
      </span>
    </button>
  );
}
