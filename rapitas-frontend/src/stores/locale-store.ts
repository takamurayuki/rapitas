import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type Locale, defaultLocale, locales } from '@/i18n/config';
import { API_BASE_URL } from '@/utils/api';

/**
 * Push the UI locale to the backend so agent prompts (research/plan/verify,
 * reports, questions) are written in the language the user reads the app in.
 * Best-effort: the UI must switch language even when the backend is down.
 */
function syncLocaleToBackend(locale: Locale): void {
  if (typeof fetch === 'undefined') return;
  void fetch(`${API_BASE_URL}/settings`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ uiLocale: locale }),
  }).catch(() => {});
}

function detectLocale(): Locale {
  if (typeof navigator === 'undefined') return defaultLocale;
  const lang = navigator.language.split('-')[0];
  return locales.includes(lang as Locale) ? (lang as Locale) : defaultLocale;
}

type LocaleState = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
};

export const useLocaleStore = create<LocaleState>()(
  persist(
    (set) => ({
      locale: defaultLocale,
      setLocale: (locale) => {
        set({ locale });
        syncLocaleToBackend(locale);
      },
    }),
    {
      name: 'locale-storage',
      onRehydrateStorage: () => (state) => {
        if (state && !state.locale) {
          state.setLocale(detectLocale());
        } else if (state) {
          // Re-assert on every boot: the backend file may lag a reinstall/reset.
          syncLocaleToBackend(state.locale);
        }
      },
    },
  ),
);
