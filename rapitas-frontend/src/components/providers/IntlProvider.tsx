'use client';

import { NextIntlClientProvider } from 'next-intl';
import { useLocaleStore } from '@/stores/locale-store';
import HtmlLangUpdater from '@/components/common/HtmlLangUpdater';
import ja from '../../../messages/ja.json';
import en from '../../../messages/en.json';

const messages = { ja, en } as const;

export default function IntlProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = useLocaleStore((s) => s.locale);

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages[locale]}
      timeZone="Asia/Tokyo"
    >
      <HtmlLangUpdater />
      {children}
    </NextIntlClientProvider>
  );
}
