'use client';

/**
 * Tauri Voice Recognition Hook
 *
 * Uses Rust-native cpal + whisper-rs via Tauri IPC for fully local,
 * offline voice recognition. Falls back to the browser-based
 * useSpeechRecognition when not running in Tauri.
 */
import { useState, useCallback, useRef, useEffect } from 'react';

/** Check if running inside Tauri. */
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

interface TauriVoiceReturn {
  isListening: boolean;
  isTranscribing: boolean;
  transcript: string;
  error: string | null;
  isSupported: boolean;
  modelDownloaded: boolean;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
}

/**
 * Voice recognition via Tauri Rust backend (cpal + whisper-rs).
 *
 * @param onResult - Callback with transcribed text / 文字起こし結果コールバック
 * @returns Voice state and controls / 音声状態とコントロール
 */
export function useTauriVoice(
  onResult?: (text: string) => void,
): TauriVoiceReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const onResultRef = useRef(onResult);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // Check Tauri availability and model status on mount
  useEffect(() => {
    if (!isTauri()) return;

    setIsSupported(true);

    // Dynamic import to avoid build errors when not in Tauri
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('voice_model_status').then((status) => {
        const s = status as { downloaded: boolean; recording: boolean };
        setModelDownloaded(s.downloaded);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  const startListening = useCallback(async () => {
    if (!isTauri()) return;

    setError(null);
    setIsListening(true);

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // voice_start_recording blocks until voice_stop_recording is called,
      // then returns the transcribed text.
      const text = await invoke('voice_start_recording') as string;

      setIsTranscribing(false);
      setIsListening(false);

      if (text.trim()) {
        setTranscript((prev) => prev + text);
        onResultRef.current?.(text);
      } else {
        setError('音声を認識できませんでした。');
      }
    } catch (err) {
      const message = typeof err === 'string' ? err : (err as Error).message || 'Unknown error';
      setError(message);
      setIsListening(false);
      setIsTranscribing(false);
    }
  }, []);

  const stopListening = useCallback(async () => {
    if (!isTauri()) return;

    setIsTranscribing(true);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('voice_stop_recording');
      // NOTE: voice_start_recording will resolve with the transcribed text.
    } catch {
      setIsListening(false);
      setIsTranscribing(false);
    }
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setError(null);
  }, []);

  return {
    isListening,
    isTranscribing,
    transcript,
    error,
    isSupported,
    modelDownloaded,
    startListening,
    stopListening,
    resetTranscript,
  };
}
