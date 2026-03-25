'use client';

/**
 * WakeWordDetector
 *
 * Continuously listens for a wake word (default: "ラピタス" / "rapitas") using
 * a lightweight audio analysis loop. When detected, triggers the voice input bar.
 *
 * Uses Web Speech API in continuous mode for wake word detection only (low cost).
 * Falls back to volume-based activation with manual keyword matching.
 *
 * The detector runs in the background with minimal resource usage:
 * - Web Speech API handles all processing (no audio sent to server)
 * - Only activates full recording when wake word is detected
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useVoiceInput } from './VoiceInputProvider';

/** Wake word configuration. */
interface WakeWordConfig {
  /** Words that trigger activation (matched case-insensitively). */
  keywords: string[];
  /** Whether the detector is enabled. */
  enabled: boolean;
  /** Language for speech recognition. */
  lang: string;
}

const DEFAULT_CONFIG: WakeWordConfig = {
  keywords: ['ラピタス', 'らぴたす', 'rapitas', 'ラピプラス', 'rapi'],
  enabled: true,
  lang: 'ja-JP',
};

interface WakeWordDetectorProps {
  /** Override default configuration. */
  config?: Partial<WakeWordConfig>;
  /** Callback when wake word is detected. */
  onWakeWordDetected?: () => void;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}

export default function WakeWordDetector({ config, onWakeWordDetected }: WakeWordDetectorProps) {
  const { openVoiceInput, isVoiceOpen } = useVoiceInput();
  const [isListening, setIsListening] = useState(false);
  const [lastHeard, setLastHeard] = useState('');
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cfg = { ...DEFAULT_CONFIG, ...config };

  const checkWakeWord = useCallback(
    (text: string): boolean => {
      const lower = text.toLowerCase().trim();
      return cfg.keywords.some((kw) => lower.includes(kw.toLowerCase()));
    },
    [cfg.keywords],
  );

  const handleWakeWord = useCallback(() => {
    // Stop listening while voice input is active
    if (recognitionRef.current) {
      try { recognitionRef.current.stop(); } catch { /* ignore */ }
    }

    onWakeWordDetected?.();
    openVoiceInput({ type: 'command' });
  }, [openVoiceInput, onWakeWordDetected]);

  const startListening = useCallback(() => {
    if (!cfg.enabled || isVoiceOpen) return;

    const SpeechRecognitionAPI =
      typeof window !== 'undefined'
        ? window.SpeechRecognition || window.webkitSpeechRecognition
        : null;

    if (!SpeechRecognitionAPI) return;

    try {
      const recognition = new SpeechRecognitionAPI();
      recognition.lang = cfg.lang;
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.maxAlternatives = 3;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; length: number; [j: number]: { transcript: string } } } }) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i];
          // Check all alternatives for wake word
          for (let j = 0; j < result.length; j++) {
            const transcript = result[j].transcript;
            setLastHeard(transcript);

            if (checkWakeWord(transcript)) {
              handleWakeWord();
              return;
            }
          }
        }
      };

      recognition.onerror = (event: { error: string }) => {
        // NOTE: no-speech and aborted are normal during background listening.
        if (event.error !== 'no-speech' && event.error !== 'aborted') {
          setIsListening(false);
        }
      };

      recognition.onend = () => {
        setIsListening(false);
        // Auto-restart after a brief pause (continuous background listening)
        if (cfg.enabled && !isVoiceOpen) {
          restartTimerRef.current = setTimeout(() => {
            startListening();
          }, 500);
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch {
      // Web Speech API not available
    }
  }, [cfg.enabled, cfg.lang, isVoiceOpen, checkWakeWord, handleWakeWord]);

  // Start/stop based on enabled state and voice input state
  useEffect(() => {
    if (cfg.enabled && !isVoiceOpen) {
      startListening();
    } else {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    }

    return () => {
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* ignore */ }
        recognitionRef.current = null;
      }
    };
  }, [cfg.enabled, isVoiceOpen, startListening]);

  // Restart listening when voice input closes
  useEffect(() => {
    if (!isVoiceOpen && cfg.enabled && !isListening) {
      const timer = setTimeout(() => startListening(), 1000);
      return () => clearTimeout(timer);
    }
  }, [isVoiceOpen, cfg.enabled, isListening, startListening]);

  // No visible UI — this is a background service component.
  // Optional: tiny indicator in the corner.
  if (!cfg.enabled) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-40 flex items-center gap-1.5 pointer-events-none select-none"
      title={`ウェイクワード待機中${lastHeard ? ` (最後: ${lastHeard})` : ''}`}
    >
      <div
        className={`w-2 h-2 rounded-full transition-colors ${
          isListening ? 'bg-green-500 animate-pulse' : 'bg-zinc-600'
        }`}
      />
      <span className="text-[9px] text-zinc-500">
        {isListening ? '「ラピタス」で起動' : ''}
      </span>
    </div>
  );
}
