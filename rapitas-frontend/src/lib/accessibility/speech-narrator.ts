/**
 * speech-narrator
 *
 * Thin wrapper over the Web Speech API for the stall-recovery narration.
 * Single responsibility: availability detection (voices can be absent on
 * WebView2/Windows) and fire-and-forget speaking. Callers MUST treat
 * isAvailable()===false as "fall back to the text + aria-live path" — this
 * module never fakes a successful narration.
 */

/** Options for one utterance. */
export interface SpeakOptions {
  /** Speech rate 0.5–2.0 (clamped; default 1.0). */
  rate?: number;
  /** BCP-47 language tag (default: the document language, then 'ja-JP'). */
  lang?: string;
}

/**
 * Whether speech synthesis can actually produce audio here. `getVoices()`
 * returning an empty array (common on WebView2 without installed voices)
 * counts as unavailable — speaking would silently no-op.
 *
 * @returns true when at least one voice is installed. / 音声が1つ以上あればtrue
 */
export function isAvailable(): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  try {
    return window.speechSynthesis.getVoices().length > 0;
  } catch {
    return false;
  }
}

/**
 * Speaks one text, cancelling any narration still in progress (stall updates
 * supersede each other — queueing them would read stale state aloud).
 *
 * @param text - Text to narrate. / 読み上げるテキスト
 * @param options - Rate/lang overrides. / 速度・言語の指定
 * @returns true when the utterance was queued; false when unavailable. / 発話開始可否
 */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (!isAvailable() || !text) return false;
  const utterance = new SpeechSynthesisUtterance(text);
  const rate = options.rate ?? 1.0;
  utterance.rate = Math.min(2.0, Math.max(0.5, Number.isNaN(rate) ? 1.0 : rate));
  utterance.lang =
    options.lang ??
    (typeof document !== 'undefined' && document.documentElement.lang
      ? document.documentElement.lang
      : 'ja-JP');
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
  return true;
}

/**
 * Stops any in-progress narration (used on panel close / Esc).
 */
export function stop(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    // Cancelling is best-effort — a failure here must never break the UI.
  }
}
