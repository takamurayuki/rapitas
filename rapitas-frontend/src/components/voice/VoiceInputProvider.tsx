'use client';

/**
 * VoiceInputProvider
 *
 * Global context provider for voice input. Any component can open the
 * voice input bar, optionally targeting a specific input field.
 * Renders the floating VoiceInputBar at the app root.
 */
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import VoiceInputBar, { type VoiceTarget } from './VoiceInputBar';
import WakeWordDetector from './WakeWordDetector';
import { API_BASE_URL } from '@/utils/api';

interface VoiceInputContextType {
  /** Open the voice input bar. */
  openVoiceInput: (target?: VoiceTarget) => void;
  /** Close the voice input bar. */
  closeVoiceInput: () => void;
  /** Whether the voice bar is currently open. */
  isVoiceOpen: boolean;
  /** Whether wake word detection is enabled. */
  wakeWordEnabled: boolean;
  /** Toggle wake word detection. */
  setWakeWordEnabled: (enabled: boolean) => void;
}

const VoiceInputContext = createContext<VoiceInputContextType>({
  openVoiceInput: () => {},
  closeVoiceInput: () => {},
  isVoiceOpen: false,
  wakeWordEnabled: false,
  setWakeWordEnabled: () => {},
});

/**
 * Use the global voice input context.
 *
 * @returns Voice input controls. / 音声入力コントロール
 */
export function useVoiceInput(): VoiceInputContextType {
  return useContext(VoiceInputContext);
}

// NOTE: Voice input is fully disabled (operator decision 2026-09-02 — the
// feature is unused, and its /transcribe/warm pre-warm calls were being
// rejected by the CSRF guard in a retry-ish pattern). Runtime is inert; full
// file/route removal is tracked as a rapitas task.
export const VOICE_INPUT_DISABLED = true;

export default function VoiceInputProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);
  const [target, setTarget] = useState<VoiceTarget | undefined>(undefined);
  const [wakeWordEnabled, setWakeWordEnabled] = useState(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('rapitas-wake-word-enabled') === 'true';
  });

  const openVoiceInput = useCallback((t?: VoiceTarget) => {
    if (VOICE_INPUT_DISABLED) return;
    setTarget(t);
    setIsOpen(true);
  }, []);

  const closeVoiceInput = useCallback(() => {
    setIsOpen(false);
    setTarget(undefined);
  }, []);

  // NOTE: Pre-warm Whisper daemon on app load so first voice input is fast.
  // Uses the app-wide API base — a host differing from the page's (127.0.0.1 vs
  // localhost) is cross-site to the browser and the CSRF guard rejects the POST.
  useEffect(() => {
    if (VOICE_INPUT_DISABLED) return;
    fetch(`${API_BASE_URL}/transcribe/warm`, { method: 'POST' }).catch(() => {});
  }, []);

  const handleSetWakeWord = useCallback((enabled: boolean) => {
    if (VOICE_INPUT_DISABLED) return;
    setWakeWordEnabled(enabled);
    localStorage.setItem('rapitas-wake-word-enabled', String(enabled));

    // Start/stop Tauri native wake word detector
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => {
          if (enabled) {
            invoke('wake_word_start').catch(() => {});
          } else {
            invoke('wake_word_stop').catch(() => {});
          }
        })
        .catch(() => {});
    }
  }, []);

  // Listen for Tauri wake-word-detected event (works even when window is minimized)
  useEffect(() => {
    if (VOICE_INPUT_DISABLED) return;
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return;

    let unlisten: (() => void) | null = null;

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        listen('wake-word-detected', () => {
          openVoiceInput({ type: 'command' });
        }).then((fn) => {
          unlisten = fn;
        });
      })
      .catch(() => {});

    // Auto-start wake word if enabled
    if (wakeWordEnabled) {
      import('@tauri-apps/api/core')
        .then(({ invoke }) => {
          invoke('wake_word_start').catch(() => {});
        })
        .catch(() => {});
    }

    return () => {
      unlisten?.();
    };
  }, [wakeWordEnabled, openVoiceInput]);

  return (
    <VoiceInputContext.Provider
      value={{
        openVoiceInput,
        closeVoiceInput,
        isVoiceOpen: isOpen,
        wakeWordEnabled,
        setWakeWordEnabled: handleSetWakeWord,
      }}
    >
      {children}
      <VoiceInputBar isOpen={isOpen} onClose={closeVoiceInput} target={target} />
      <WakeWordDetector config={{ enabled: wakeWordEnabled }} />
    </VoiceInputContext.Provider>
  );
}
