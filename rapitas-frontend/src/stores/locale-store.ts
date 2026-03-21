import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { type Locale, defaultLocale, locales } from '@/i18n/config';

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
      setLocale: (locale) => set({ locale }),
    }),
    {
      name: 'locale-storage',
      onRehydrateStorage: () => (state) => {
        if (state && !state.locale) {
          state.setLocale(detectLocale());
        }
      },
    },
  ),
);
