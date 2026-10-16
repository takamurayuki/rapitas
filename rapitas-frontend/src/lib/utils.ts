export function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}

/**
 * Convert app locale ('ja' | 'en') to BCP 47 locale string for Intl APIs.
 */
export function toDateLocale(locale: string): string {
  const localeMap: Record<string, string> = {
    ja: 'ja-JP',
    en: 'en-US',
  };
  return localeMap[locale] || 'ja-JP';
}

// NOTE: formatDate/formatDateTime/formatTime (locale-dependent Intl wrappers) were
// removed here — the app now standardizes on the locale-independent formatters in
// `@/utils/date` (formatDate/formatDateTime/formatTime) per task #847.
