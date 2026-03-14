'use client';

import { useTranslations } from 'next-intl';
import { Settings, Code, GraduationCap, Layers, Globe } from 'lucide-react';
import { useAppModeStore, type AppMode } from '@/stores/appModeStore';
import { useLocaleStore } from '@/stores/localeStore';
import { locales, type Locale } from '@/i18n/config';

const MODE_OPTIONS: {
  value: AppMode;
  labelKey: string;
  descriptionKey: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: 'all',
    labelKey: 'showAll',
    descriptionKey: 'showAllDescription',
    icon: Layers,
  },
  {
    value: 'development',
    labelKey: 'devMode',
    descriptionKey: 'devModeDescription',
    icon: Code,
  },
  {
    value: 'learning',
    labelKey: 'learningMode',
    descriptionKey: 'learningModeDescription',
    icon: GraduationCap,
  },
];

const LOCALE_LABELS: Record<Locale, string> = {
  ja: '日本語',
  en: 'English',
};

export default function GeneralSettingsPage() {
  const t = useTranslations('settings');
  const { mode, setMode } = useAppModeStore();
  const { locale, setLocale } = useLocaleStore();

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
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {t('generalDescription')}
          </p>
        </div>
      </div>

      <div className="space-y-6">
        <div className="bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-zinc-200 dark:border-zinc-800">
            <div className="flex items-center gap-3">
              <Layers className="w-5 h-5 text-zinc-400" />
              <div>
                <h2 className="font-semibold text-zinc-900 dark:text-zinc-50">
                  {t('displayMode')}
                </h2>
                <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
                  {t('displayModeDescription')}
                </p>
              </div>
            </div>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {MODE_OPTIONS.map((option) => {
                const Icon = option.icon;
                const isSelected = mode === option.value;

                return (
                  <button
                    key={option.value}
                    onClick={() => setMode(option.value)}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      isSelected
                        ? 'border-violet-500 bg-violet-50 dark:bg-violet-900/20'
                        : 'border-zinc-200 dark:border-zinc-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-zinc-800'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-2 right-2">
                        <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
                      </div>
                    )}
                    <Icon
                      className={`w-6 h-6 mb-2 ${
                        isSelected
                          ? 'text-violet-600 dark:text-violet-400'
                          : 'text-zinc-400 dark:text-zinc-500'
                      }`}
                    />
                    <h3
                      className={`font-medium text-sm ${
                        isSelected
                          ? 'text-violet-700 dark:text-violet-300'
                          : 'text-zinc-900 dark:text-zinc-100'
                      }`}
                    >
                      {t(option.labelKey)}
                    </h3>
                    <p
                      className={`text-xs mt-1 ${
                        isSelected
                          ? 'text-violet-500 dark:text-violet-400'
                          : 'text-zinc-500 dark:text-zinc-400'
                      }`}
                    >
                      {t(option.descriptionKey)}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

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
      </div>
    </div>
  );
}
