'use client';

/**
 * Speech Recognition Hook
 *
 * Two-tier voice-to-text:
 *   1. Primary: Web Speech API (free, instant, works with built-in mics)
 *   2. Fallback: MediaRecorder + OpenAI Whisper API (works with all mics including Bluetooth)
 *
 * Automatically falls back to Whisper when Web Speech API fails with no-speech
 * or is unavailable. The fallback records audio via getUserMedia (which works
 * with Bluetooth) and sends it to the backend for transcription.
 *
 * Pure helpers live in `speech-recognition-utils`; the recording/recognition
 * control flows live in `speech-recognition-controllers`.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { BACKEND_URL } from './speech-recognition-utils';
import {
  sendForTranscription as sendForTranscriptionImpl,
  startWhisperRecording as startWhisperRecordingImpl,
  startWebSpeechAPI as startWebSpeechAPIImpl,
  type SpeechControllerContext,
} from './speech-recognition-controllers';
import type { UseSpeechRecognitionReturn } from './speech-recognition.types';

/**
 * Use voice input with automatic fallback from Web Speech API to Whisper.
 *
 * @param lang - BCP47 language code. Defaults to 'ja-JP'. / 言語コード
 * @param onResult - Callback with final transcript. / 最終テキストのコールバック
 * @returns Speech recognition state and controls. / 音声認識状態とコントロール
 */
export function useSpeechRecognition(
  lang: string = 'ja-JP',
  onResult?: (transcript: string) => void,
): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  // NOTE: Default to Whisper mode (getUserMedia + backend transcription) for reliability.
  // Web Speech API has issues with Bluetooth mics and Tauri WebView.
  const [useWhisperFallback, setUseWhisperFallback] = useState(true);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const onResultRef = useRef(onResult);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRawTextRef = useRef<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sendForTranscriptionRef = useRef<(chunks: Float32Array[], rate: number) => void>(() => {});

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // NOTE: Check support after mount. getUserMedia is always available (Whisper fallback).
  useEffect(() => {
    const hasWebSpeech = 'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    const hasMediaDevices = 'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
    setIsSupported(hasWebSpeech || hasMediaDevices);
  }, []);

  // NOTE: Bundle the state setters + refs for the controllers. Setters/refs are
  // stable, so this only changes when `lang` changes (matching the original
  // useCallback dependency lists).
  const controllerCtx = useMemo<SpeechControllerContext>(
    () => ({
      lang,
      setError,
      setIsListening,
      setIsTranscribing,
      setTranscript,
      setInterimTranscript,
      setActiveStream,
      setUseWhisperFallback,
      streamRef,
      audioCtxRef,
      mediaRecorderRef,
      lastRawTextRef,
      onResultRef,
    }),
    [lang],
  );

  /** Send recorded PCM chunks as WAV to backend for transcription. */
  const sendForTranscription = useCallback(
    (pcmChunks: Float32Array[], nativeSampleRate: number) =>
      sendForTranscriptionImpl(controllerCtx, pcmChunks, nativeSampleRate),
    [controllerCtx],
  );

  // NOTE: Keep ref in sync so setInterval closure always calls the latest version.
  useEffect(() => {
    sendForTranscriptionRef.current = sendForTranscription;
  }, [sendForTranscription]);

  /**
   * Record audio with automatic silence detection.
   * Auto-sends for transcription when silence is detected for 1.5 seconds.
   */
  const startWhisperRecording = useCallback(() => {
    void startWhisperRecordingImpl(controllerCtx);
  }, [controllerCtx]);

  /**
   * Try Web Speech API first. If it fails with no-speech, switch to Whisper.
   */
  const startWebSpeechAPI = useCallback(() => {
    startWebSpeechAPIImpl(controllerCtx, startWhisperRecording);
  }, [controllerCtx, startWhisperRecording]);

  const startListening = useCallback(() => {
    if (useWhisperFallback) {
      startWhisperRecording();
    } else {
      startWebSpeechAPI();
    }
  }, [useWhisperFallback, startWhisperRecording, startWebSpeechAPI]);

  const stopListening = useCallback(() => {
    // Stop MediaRecorder — onstop handler will process and send audio
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
      return;
    }

    // Cleanup fallback
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setActiveStream(null);
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  const resetTranscript = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  /**
   * Submit a user correction to improve future transcription accuracy.
   *
   * Call this when the user edits the transcribed text before submitting.
   * The backend learns the difference between the raw Whisper output
   * and the user's corrected version.
   *
   * @param correctedText - User's edited version of the transcript / ユーザーの修正テキスト
   */
  const submitCorrection = useCallback((correctedText: string) => {
    const rawText = lastRawTextRef.current;
    if (!rawText || rawText === correctedText) return;

    fetch(`${BACKEND_URL}/transcribe/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rawText, correctedText }),
    }).catch(() => {
      // NOTE: Correction submission failure is non-critical — don't block the user.
    });
  }, []);

  return {
    isListening,
    isTranscribing,
    transcript,
    interimTranscript,
    error,
    isSupported,
    startListening,
    stopListening,
    resetTranscript,
    submitCorrection,
    activeStream,
  };
}
