/**
 * voice-narration-store
 *
 * User settings for the stall-recovery voice narration (enabled / rate /
 * verbosity), persisted to localStorage. Deliberately NOT stored in
 * UserSettings (DB): these are device-local preferences and a Prisma schema
 * change would force a server restart. Not responsible for TTS playback —
 * that lives in lib/accessibility/speech-narrator.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Narration detail level (mirrors the backend's StallVerbosity). */
export type VoiceVerbosity = 'concise' | 'standard' | 'detailed';

/** Web Speech API recommended range for SpeechSynthesisUtterance.rate. */
export const VOICE_RATE_MIN = 0.5;
export const VOICE_RATE_MAX = 2.0;

interface VoiceNarrationState {
  /** Master switch for voice narration. */
  enabled: boolean;
  /** Speech rate (0.5–2.0, 1.0 = normal). */
  rate: number;
  /** Narration detail level. */
  verbosity: VoiceVerbosity;
  setEnabled: (enabled: boolean) => void;
  setRate: (rate: number) => void;
  setVerbosity: (verbosity: VoiceVerbosity) => void;
}

/**
 * Clamps a rate into the Web Speech API's safe range.
 *
 * @param rate - Requested rate. / 要求された速度
 * @returns Rate clamped to 0.5–2.0. / 0.5〜2.0に収めた速度
 */
export function clampVoiceRate(rate: number): number {
  if (Number.isNaN(rate)) return 1.0;
  return Math.min(VOICE_RATE_MAX, Math.max(VOICE_RATE_MIN, rate));
}

export const useVoiceNarrationStore = create<VoiceNarrationState>()(
  persist(
    (set) => ({
      enabled: true,
      rate: 1.0,
      verbosity: 'standard',
      setEnabled: (enabled) => set({ enabled }),
      setRate: (rate) => set({ rate: clampVoiceRate(rate) }),
      setVerbosity: (verbosity) => set({ verbosity }),
    }),
    {
      name: 'voice-narration-storage',
    },
  ),
);
