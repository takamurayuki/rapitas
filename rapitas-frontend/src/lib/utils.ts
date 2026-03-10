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

/**
 * Format a date using the app's current locale setting.
 */
export function formatDate(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(toDateLocale(locale), options);
}
