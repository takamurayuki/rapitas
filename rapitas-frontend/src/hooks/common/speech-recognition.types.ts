/**
 * speech-recognition.types
 *
 * Minimal TypeScript declarations for the browser's experimental Web Speech
 * API (`SpeechRecognition` / `webkitSpeechRecognition`). The DOM lib does
 * not ship these types yet, so we declare them locally — only the shape we
 * actually consume in `useSpeechRecognition`.
 *
 * Spec: https://wicg.github.io/speech-api/
 */

export interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

export interface SpeechRecognitionResult {
  [index: number]: SpeechRecognitionAlternative;
  length: number;
  isFinal: boolean;
}

export interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onstart: () => void;
  onend: () => void;
}

// NOTE: The global Window augmentation is intentionally omitted here.
// WakeWordDetector.tsx uses the SpeechRecognition type via a direct
// import from this file, and declaring Window.SpeechRecognition in
// multiple files causes TS2717 (duplicate property with different
// identity). The runtime access `window.SpeechRecognition` works
// without a type declaration because the actual browser API provides it.
