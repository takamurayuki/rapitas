/**
 * pomodoroAudio
 *
 * Web Audio API utilities for Pomodoro timer notifications.
 * Manages a shared AudioContext singleton and provides typed notification sounds.
 */

// NOTE: Singleton held at module level to avoid creating multiple AudioContext instances,
// which browsers may limit or warn about.
let audioContext: AudioContext | null = null;

/**
 * Returns (and lazily creates) the shared AudioContext.
 * Safe to call in SSR — returns null when window is unavailable.
 *
 * @returns AudioContext instance or null / AudioContextインスタンス、またはnull
 */
export const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (!audioContext) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioContext = new AudioContextClass();
  }
  return audioContext;
};

/**
 * Closes and nulls out the shared AudioContext.
 * Called on beforeunload to release OS audio resources.
 */
export const closeAudioContext = (): void => {
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
};

/**
 * Plays a short beep notification using the Web Audio API.
 *
 * @param type - 'work' plays three ascending beeps; 'break' plays two descending beeps / 'work'は3回上昇、'break'は2回下降
 * @param volume - Gain level from 0 to 1, defaults to 0.5 / 音量（0〜1）、デフォルト0.5
 */
export const playNotificationSound = (type: 'work' | 'break', volume: number = 0.5): void => {
  const context = getAudioContext();
  if (!context) return;

  // NOTE: Browser autoplay policy suspends AudioContext until user interaction triggers resume.
  if (context.state === 'suspended') {
    context.resume();
  }

  const adjustedVolume = Math.max(0.01, Math.min(1, volume));

  if (type === 'work') {
    const playBeep = (delay: number) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(adjustedVolume, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + delay + 0.15);
      osc.start(context.currentTime + delay);
      osc.stop(context.currentTime + delay + 0.15);
    };
    playBeep(0);
    playBeep(0.2);
    playBeep(0.4);
  } else {
    const playBeep = (delay: number, frequency: number) => {
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.connect(gain);
      gain.connect(context.destination);
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(adjustedVolume, context.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.01, context.currentTime + delay + 0.2);
      osc.start(context.currentTime + delay);
      osc.stop(context.currentTime + delay + 0.2);
    };
    playBeep(0, 660);
    playBeep(0.25, 523);
  }
};
