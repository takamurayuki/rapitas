/**
 * AccessibilitySettingsPage
 *
 * Settings page for accessibility features (voice narration of the
 * stall-recovery panel). Route entry point only — the actual controls live
 * in _components/VoiceSettingsPanel.
 */
'use client';

import { useTranslations } from 'next-intl';
import { VoiceSettingsPanel } from './_components/VoiceSettingsPanel';

export default function AccessibilitySettingsPage() {
  const t = useTranslations('accessibility');

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">{t('title')}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{t('description')}</p>
      </div>
      <VoiceSettingsPanel />
    </div>
  );
}
