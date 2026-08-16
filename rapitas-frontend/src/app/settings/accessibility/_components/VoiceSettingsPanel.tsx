/**
 * VoiceSettingsPanel
 *
 * Controls for the stall-recovery voice narration: master switch, speech rate
 * (0.5–2.0) and verbosity (concise/standard/detailed), persisted via
 * voice-narration-store (localStorage). Includes a preview button and an
 * availability note when no TTS voices are installed.
 */
'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  useVoiceNarrationStore,
  VOICE_RATE_MIN,
  VOICE_RATE_MAX,
  type VoiceVerbosity,
} from '@/stores/voice-narration-store';
import { isAvailable, speak } from '@/lib/accessibility/speech-narrator';

const VERBOSITY_OPTIONS: VoiceVerbosity[] = ['concise', 'standard', 'detailed'];

export function VoiceSettingsPanel() {
  const t = useTranslations('accessibility');
  const enabled = useVoiceNarrationStore((s) => s.enabled);
  const rate = useVoiceNarrationStore((s) => s.rate);
  const verbosity = useVoiceNarrationStore((s) => s.verbosity);
  const setEnabled = useVoiceNarrationStore((s) => s.setEnabled);
  const setRate = useVoiceNarrationStore((s) => s.setRate);
  const setVerbosity = useVoiceNarrationStore((s) => s.setVerbosity);

  // Voice availability is a browser runtime fact — resolved after mount to
  // keep SSR output stable.
  const [voiceReady, setVoiceReady] = useState(true);
  useEffect(() => {
    setVoiceReady(isAvailable());
  }, []);

  return (
    <div className="bg-white dark:bg-zinc-800 rounded-xl border border-zinc-200 dark:border-zinc-700 p-6 mb-6">
      <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-50 mb-1">
        {t('voiceSection')}
      </h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-4">
        {t('voiceSectionDescription')}
      </p>

      {!voiceReady && (
        <div className="p-3 mb-4 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 rounded-lg text-sm">
          {t('voiceUnavailableNote')}
        </div>
      )}

      {/* Master switch */}
      <div className="flex items-center justify-between py-3 border-b border-zinc-100 dark:border-zinc-700">
        <label htmlFor="voice-enabled" className="text-sm text-zinc-700 dark:text-zinc-300">
          {t('enabledLabel')}
        </label>
        <button
          id="voice-enabled"
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t('enabledLabel')}
          onClick={() => setEnabled(!enabled)}
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            enabled ? 'bg-indigo-500' : 'bg-zinc-300 dark:bg-zinc-600'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Speech rate */}
      <div className="py-3 border-b border-zinc-100 dark:border-zinc-700">
        <div className="flex items-center justify-between mb-2">
          <label htmlFor="voice-rate" className="text-sm text-zinc-700 dark:text-zinc-300">
            {t('rateLabel')}
          </label>
          <span className="text-sm font-mono text-zinc-500 dark:text-zinc-400">
            {rate.toFixed(1)}x
          </span>
        </div>
        <input
          id="voice-rate"
          aria-label={t('rateLabel')}
          type="range"
          min={VOICE_RATE_MIN}
          max={VOICE_RATE_MAX}
          step={0.1}
          value={rate}
          disabled={!enabled}
          onChange={(e) => setRate(parseFloat(e.target.value))}
          className="w-full accent-indigo-500 disabled:opacity-50"
        />
      </div>

      {/* Verbosity */}
      <div className="py-3 border-b border-zinc-100 dark:border-zinc-700">
        <span className="block text-sm text-zinc-700 dark:text-zinc-300 mb-2">
          {t('verbosityLabel')}
        </span>
        <div role="radiogroup" aria-label={t('verbosityLabel')} className="flex gap-2">
          {VERBOSITY_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={verbosity === option}
              disabled={!enabled}
              onClick={() => setVerbosity(option)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 ${
                verbosity === option
                  ? 'bg-indigo-500 text-white border-indigo-500'
                  : 'bg-zinc-100 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-600 hover:border-indigo-400'
              }`}
            >
              {t(`verbosity.${option}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Preview */}
      <div className="pt-4">
        <button
          type="button"
          disabled={!enabled || !voiceReady}
          onClick={() => speak(t('previewText'), { rate })}
          className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700 text-white disabled:text-zinc-500 dark:disabled:text-zinc-400 rounded-lg text-sm font-medium transition-colors"
        >
          {t('previewButton')}
        </button>
      </div>
    </div>
  );
}
