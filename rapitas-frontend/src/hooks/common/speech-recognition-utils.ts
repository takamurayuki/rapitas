/**
 * speech-recognition-utils
 *
 * Pure helpers for the speech recognition hook: backend transcription calls,
 * audio analyser/level math, silence detection config, WAV conversion, and
 * interim-transcript formatting. Holds no React state. Display strings are
 * resolved via a translator function passed in by the caller (see
 * `SpeechTranslator`) rather than a hook, since this module is not a React
 * component.
 */
import { encodeWav, resamplePcm } from '@/lib/audio/wav-codec';

/**
 * Translator shape accepted by these helpers. Structurally matches next-intl's
 * `useTranslations('voice')` return value — callers pass that hook result
 * straight through.
 */
export type SpeechTranslator = (key: string, params?: Record<string, string | number>) => string;

/** Backend base URL for transcription endpoints. */
export const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

// ────────────────────────────────────────────────────────────────────────────
// Silence Detection Configuration
// ────────────────────────────────────────────────────────────────────────────

/** Configuration for silence detection. */
export const SILENCE_CONFIG = {
  /** Byte frequency average threshold (0-255 scale) */
  THRESHOLD: 5,
  /** RMS threshold for time-domain data */
  RMS_THRESHOLD: 0.005,
  /** Silence duration before auto-send (ms) */
  DURATION_MS: 1500,
  /** Polling interval for silence check (ms) */
  CHECK_INTERVAL_MS: 100,
} as const;

// ────────────────────────────────────────────────────────────────────────────
// Transcription API Helper
// ────────────────────────────────────────────────────────────────────────────

/** Result from transcription API. */
export interface TranscriptionResult {
  text: string;
  rawText?: string;
}

/** Error result from transcription API. */
interface TranscriptionError {
  error?: string;
}

/**
 * Send audio blob to backend for transcription.
 *
 * @param audioBlob - WAV audio blob to transcribe / 文字起こし対象のWAV音声
 * @param langCode - Language code (e.g., 'ja') / 言語コード
 * @param t - Translator scoped to `voice`, used for the localized fallback error / `voice` にスコープした翻訳関数（フォールバックエラー用）
 * @returns Transcription result or error / 文字起こし結果またはエラー
 */
export async function transcribeAudioBlob(
  audioBlob: Blob,
  langCode: string,
  t: SpeechTranslator,
): Promise<{ success: true; result: TranscriptionResult } | { success: false; error: string }> {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'audio.wav');
  formData.append('language', langCode);

  const response = await fetch(`${BACKEND_URL}/transcribe`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Unknown error' }));
    return {
      success: false,
      error: (data as TranscriptionError).error || t('inputBar.transcribeFailed'),
    };
  }

  const result = (await response.json()) as TranscriptionResult;
  return { success: true, result };
}

// ────────────────────────────────────────────────────────────────────────────
// Audio Processing Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create AudioContext with connected analyser for silence detection.
 *
 * @param stream - Microphone media stream / マイクのメディアストリーム
 * @returns AudioContext and connected analyser node / AudioContextと接続済みアナライザー
 */
export function createAudioAnalyser(stream: MediaStream): {
  audioCtx: AudioContext;
  analyser: AnalyserNode;
} {
  const audioCtx = new AudioContext();
  const source = audioCtx.createMediaStreamSource(stream);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  return { audioCtx, analyser };
}

/**
 * Calculate audio levels from analyser node.
 *
 * @param analyser - Web Audio analyser node / Web Audioのアナライザーノード
 * @returns Frequency average and RMS levels / 周波数平均とRMSレベル
 */
export function calculateAudioLevels(analyser: AnalyserNode): { freqAvg: number; rms: number } {
  const freqData = new Uint8Array(analyser.frequencyBinCount);
  analyser.getByteFrequencyData(freqData);
  let sum = 0;
  for (let i = 0; i < freqData.length; i++) sum += freqData[i];
  const freqAvg = sum / freqData.length;

  const timeData = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(timeData);
  let rmsSum = 0;
  for (let i = 0; i < timeData.length; i++) rmsSum += timeData[i] * timeData[i];
  const rms = Math.sqrt(rmsSum / timeData.length);

  return { freqAvg, rms };
}

/**
 * Check if audio levels indicate sound (not silence).
 *
 * @param freqAvg - Frequency average level / 周波数平均レベル
 * @param rms - RMS level / RMSレベル
 * @returns True when sound is detected / 音が検出された場合true
 */
export function hasSound(freqAvg: number, rms: number): boolean {
  return freqAvg > SILENCE_CONFIG.THRESHOLD || rms > SILENCE_CONFIG.RMS_THRESHOLD;
}

/**
 * Convert recorded audio blob to 16kHz WAV.
 *
 * @param audioBlob - Recorded audio blob (e.g. webm) / 録音された音声blob
 * @returns 16kHz mono WAV blob / 16kHzモノラルWAV blob
 */
export async function convertToWav(audioBlob: Blob): Promise<Blob> {
  const arrayBuffer = await audioBlob.arrayBuffer();
  const decodeCtx = new AudioContext();
  const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const pcmData = audioBuffer.getChannelData(0);
  const nativeRate = audioBuffer.sampleRate;
  const resampled = nativeRate === 16000 ? pcmData : resamplePcm(pcmData, nativeRate, 16000);
  return encodeWav(
    resampled instanceof Float32Array ? resampled : new Float32Array(resampled),
    16000,
  );
}

/**
 * Format interim transcript with audio level info.
 *
 * @param t - Translator scoped to `voice` / `voice` にスコープした翻訳関数
 * @param hasSpoken - Whether speech has been detected yet / これまでに発話が検出されたか
 * @param freqAvg - Frequency average level / 周波数平均レベル
 * @param rms - RMS level / RMSレベル
 * @param silenceMs - Milliseconds of trailing silence / 末尾無音のミリ秒
 * @returns Localized interim status string / ローカライズされた途中経過文字列
 */
export function formatInterimTranscript(
  t: SpeechTranslator,
  hasSpoken: boolean,
  freqAvg: number,
  rms: number,
  silenceMs: number,
): string {
  if (hasSpoken) {
    return t('speechRecognitionHook.recordingWithLevel', {
      freqAvg: freqAvg.toFixed(0),
      rms: (rms * 1000).toFixed(0),
      silenceSec: (silenceMs / 1000).toFixed(1),
    });
  }
  return t('speechRecognitionHook.listeningWithLevel', {
    freqAvg: freqAvg.toFixed(0),
    rms: (rms * 1000).toFixed(0),
  });
}
