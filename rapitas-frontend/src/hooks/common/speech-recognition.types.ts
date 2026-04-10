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
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onstart: () => void;
  onend: () => void;
}

// Global Window augmentation — this is the SOLE file that declares these.
// Do NOT duplicate this in other files (causes TS2717).
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognition;
    webkitSpeechRecognition: new () => SpeechRecognition;
  }
}
