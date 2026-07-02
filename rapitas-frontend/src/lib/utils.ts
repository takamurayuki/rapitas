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

/**
 * Format a date and time using the app's current locale setting.
 *
 * @param date - date to format / フォーマットする日付
 * @param locale - app locale ('ja' | 'en') / アプリのロケール
 * @param options - Intl.DateTimeFormat options / Intl.DateTimeFormatオプション
 * @returns locale-formatted date-time string / ロケールに応じた日時文字列
 */
export function formatDateTime(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString(toDateLocale(locale), options);
}

/**
 * Format a time (no date component) using the app's current locale setting.
 *
 * @param date - date to format / フォーマットする日付
 * @param locale - app locale ('ja' | 'en') / アプリのロケール
 * @param options - Intl.DateTimeFormat options / Intl.DateTimeFormatオプション
 * @returns locale-formatted time string / ロケールに応じた時刻文字列
 */
export function formatTime(
  date: Date | string,
  locale: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleTimeString(toDateLocale(locale), options);
}
