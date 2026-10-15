'use client';

import { useEffect, useState } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from '@/stores/locale-store';
import HtmlLangUpdater from '@/components/common/HtmlLangUpdater';
import { defaultLocale, type Locale } from '@/i18n/config';
import defaultMessages from '../../../messages/ja.json';

type Messages = typeof defaultMessages;

/**
 * Catalogs for the non-default locales, fetched on demand.
 *
 * Measured 2026-10-15 (task 1268): `ja.json` is 309.3 KB and `en.json` is
 * 268.1 KB. This component is a provider, so anything it imports statically
 * lands in the eager bundle — importing both put 577 KB there to use one, and
 * left the largest eager chunk 6.4 KB under the 500 KB CI budget. Every feature
 * adds strings to BOTH files, so the chunk grew at twice the rate of the work.
 *
 * The DEFAULT locale stays a static import: it is what the first paint needs,
 * and awaiting it would blank the app on every cold load.
 */
const lazyCatalogs: Partial<Record<Locale, () => Promise<{ default: Messages }>>> = {
  en: () => import('../../../messages/en.json') as Promise<{ default: Messages }>,
};

/** Resolved catalogs, so switching back to a locale is synchronous. */
const resolved = new Map<Locale, Messages>([[defaultLocale, defaultMessages]]);

export default function IntlProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocaleStore((s) => s.locale);
  const [messages, setMessages] = useState<Messages>(() => resolved.get(locale) ?? defaultMessages);

  useEffect(() => {
    const cached = resolved.get(locale);
    if (cached) {
      setMessages(cached);
      return;
    }
    const load = lazyCatalogs[locale];
    if (!load) return;
    let active = true;
    void load().then((mod) => {
      resolved.set(locale, mod.default);
      // The user may have switched again while this was in flight; a stale
      // catalog must not overwrite the newer one.
      if (active) setMessages(mod.default);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  return (
    // NOTE: for the one render between a locale switch and its catalog
    // arriving, `messages` is still the previous locale's. Showing the previous
    // language briefly is the deliberate trade against blanking the whole app;
    // next-intl needs a non-null catalog to render children at all.
    <NextIntlClientProvider locale={locale} messages={messages} timeZone="Asia/Tokyo">
      <HtmlLangUpdater />
      {children}
    </NextIntlClientProvider>
  );
}
