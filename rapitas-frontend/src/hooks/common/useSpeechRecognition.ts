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
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { encodeWav, resamplePcm } from '@/lib/audio/wav-codec';
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from './speech-recognition.types';

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001';

/** Hook return type. */
interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  interimTranscript: string;
  error: string | null;
  isSupported: boolean;
  isTranscribing: boolean;
  startListening: () => void;
  stopListening: () => void;
  resetTranscript: () => void;
  /** Submit a user correction to improve future accuracy. / ユーザー修正を送信して将来の精度を向上 */
  submitCorrection: (correctedText: string) => void;
  /** Active MediaStream for waveform visualization (null when not recording). */
  activeStream: MediaStream | null;
}

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
  const audioChunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const lastRawTextRef = useRef<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pcmChunksRef = useRef<Float32Array[]>([]);
  const sendForTranscriptionRef = useRef<(chunks: Float32Array[], rate: number) => void>(() => {});

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  // NOTE: Check support after mount. getUserMedia is always available (Whisper fallback).
  useEffect(() => {
    const hasWebSpeech =
      'SpeechRecognition' in window || 'webkitSpeechRecognition' in window;
    const hasMediaDevices =
      'mediaDevices' in navigator && 'getUserMedia' in navigator.mediaDevices;
    setIsSupported(hasWebSpeech || hasMediaDevices);
  }, []);

  /** Send recorded PCM chunks as WAV to backend for transcription. */
  const sendForTranscription = useCallback(
    async (pcmChunks: Float32Array[], nativeSampleRate: number) => {
      const totalLength = pcmChunks.reduce((sum, c) => sum + c.length, 0);
      if (totalLength < 1600) {
        setError('録音が短すぎます。');
        setIsListening(false);
        return;
      }

      const merged = new Float32Array(totalLength);
      let off = 0;
      for (const chunk of pcmChunks) {
        merged.set(chunk, off);
        off += chunk.length;
      }

      const resampled =
        nativeSampleRate === 16000
          ? merged
          : resamplePcm(merged, nativeSampleRate, 16000);
      const wavBlob = encodeWav(resampled, 16000);

      setIsTranscribing(true);
      setInterimTranscript('文字起こし中...');

      try {
        const formData = new FormData();
        formData.append('audio', wavBlob, 'audio.wav');
        formData.append('language', lang.split('-')[0]);

        const response = await fetch(`${BACKEND_URL}/transcribe`, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const data = await response
            .json()
            .catch(() => ({ error: 'Unknown error' }));
          setError(
            (data as { error?: string }).error || '文字起こしに失敗しました',
          );
          return;
        }

        const result = (await response.json()) as {
          text: string;
          rawText?: string;
        };
        if (result.text.trim()) {
          lastRawTextRef.current = result.rawText || result.text;
          setTranscript((prev) => prev + result.text);
          onResultRef.current?.(result.text);
        }
      } catch {
        setError('文字起こしサーバーへの接続に失敗しました。');
      } finally {
        setIsTranscribing(false);
        setInterimTranscript('');
      }
    },
    [lang],
  );

  // NOTE: Keep ref in sync so setInterval closure always calls the latest version.
  useEffect(() => {
    sendForTranscriptionRef.current = sendForTranscription;
  }, [sendForTranscription]);

  /**
   * Record audio with automatic silence detection.
   * Auto-sends for transcription when silence is detected for 1.5 seconds.
   */
  const startWhisperRecording = useCallback(async () => {
    try {
      setError(null);
      setInterimTranscript('話してください...');

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      setActiveStream(stream);

      // NOTE: Use MediaRecorder for reliable audio capture (ScriptProcessorNode is unreliable).
      // Use AnalyserNode separately for silence detection.
      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm',
      });
      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      // Silence detection via AnalyserNode polling
      const SILENCE_THRESHOLD = 5; // byte frequency average (0-255 scale)
      const SILENCE_DURATION_MS = 1500;
      const state = { lastSoundTime: 0, hasSpoken: false, sent: false };
      const freqData = new Uint8Array(analyser.frequencyBinCount);

      const silenceCheckInterval = setInterval(() => {
        if (state.sent) {
          clearInterval(silenceCheckInterval);
          return;
        }

        analyser.getByteFrequencyData(freqData);
        let sum = 0;
        for (let i = 0; i < freqData.length; i++) sum += freqData[i];
        const avg = sum / freqData.length;

        // Also check time-domain data for any signal
        const timeData = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(timeData);
        let rms = 0;
        for (let i = 0; i < timeData.length; i++) rms += timeData[i] * timeData[i];
        rms = Math.sqrt(rms / timeData.length);

        const hasSound = avg > SILENCE_THRESHOLD || rms > 0.005;

        if (hasSound) {
          state.lastSoundTime = Date.now();
          if (!state.hasSpoken) {
            state.hasSpoken = true;
          }
        }

        // Always show current audio level for debugging
        const silenceMs = state.lastSoundTime > 0 ? Date.now() - state.lastSoundTime : 0;
        setInterimTranscript(
          state.hasSpoken
            ? `録音中... (音量:${avg.toFixed(0)} rms:${(rms * 1000).toFixed(0)} 無音:${(silenceMs / 1000).toFixed(1)}s)`
            : `話してください... (音量:${avg.toFixed(0)} rms:${(rms * 1000).toFixed(0)})`,
        );

        // Auto-send after silence following speech
        if (
          state.hasSpoken &&
          state.lastSoundTime > 0 &&
          Date.now() - state.lastSoundTime > SILENCE_DURATION_MS
        ) {
          state.sent = true;
          clearInterval(silenceCheckInterval);
          mediaRecorder.stop();
        }
      }, 100);

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setActiveStream(null);
        audioCtx.close();
        audioCtxRef.current = null;
        mediaRecorderRef.current = null;

        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        if (audioBlob.size < 500) {
          setError('録音が短すぎます。');
          setIsListening(false);
          return;
        }

        // Decode webm to PCM using OfflineAudioContext
        setIsTranscribing(true);
        setIsListening(false);
        setInterimTranscript('文字起こし中...');

        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const decodeCtx = new AudioContext();
          const audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
          await decodeCtx.close();

          const pcmData = audioBuffer.getChannelData(0);
          const nativeRate = audioBuffer.sampleRate;
          const resampled = nativeRate === 16000 ? pcmData : resamplePcm(pcmData, nativeRate, 16000);
          const wavBlob = encodeWav(resampled instanceof Float32Array ? resampled : new Float32Array(resampled), 16000);

          const formData = new FormData();
          formData.append('audio', wavBlob, 'audio.wav');
          formData.append('language', lang.split('-')[0]);

          const response = await fetch(`${BACKEND_URL}/transcribe`, {
            method: 'POST',
            body: formData,
          });

          if (response.ok) {
            const result = (await response.json()) as { text: string; rawText?: string };
            if (result.text.trim()) {
              lastRawTextRef.current = result.rawText || result.text;
              setTranscript((prev) => prev + result.text);
              onResultRef.current?.(result.text);
            }
          } else {
            const data = await response.json().catch(() => ({ error: 'Unknown error' }));
            setError((data as { error?: string }).error || '文字起こしに失敗しました');
          }
        } catch (decodeErr) {
          setError(`音声処理エラー: ${decodeErr instanceof Error ? decodeErr.message : 'Unknown'}`);
        } finally {
          setIsTranscribing(false);
          setInterimTranscript('');
        }
      };

      mediaRecorder.start(500);

      audioCtxRef.current = audioCtx;
      mediaRecorderRef.current = mediaRecorder;

      setIsListening(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message.includes('Permission') || message.includes('NotAllowed')) {
        setError('マイクの使用が許可されていません。');
      } else {
        setError(`マイクの起動に失敗しました: ${message}`);
      }
      setIsListening(false);
    }
  }, [lang]);

  /**
   * Try Web Speech API first. If it fails with no-speech, switch to Whisper.
   */
  const startWebSpeechAPI = useCallback(() => {
    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      // No Web Speech API — go directly to Whisper
      setUseWhisperFallback(true);
      startWhisperRecording();
      return;
    }

    setError(null);
    setInterimTranscript('');

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let final = '';
      const startIdx = event.resultIndex ?? 0;

      for (let i = startIdx; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += text;
        } else {
          interim += text;
        }
      }

      if (final) {
        setTranscript((prev) => prev + final);
        onResultRef.current?.(final);
      }
      setInterimTranscript(interim);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error || 'unknown';
      if (
        code === 'no-speech' ||
        code === 'audio-capture' ||
        code === 'aborted'
      ) {
        // NOTE: Web Speech API failed — switch to Whisper fallback for this session.
        recognition.stop();
        setUseWhisperFallback(true);
        setError(null);
        startWhisperRecording();
        return;
      }
      if (code === 'not-allowed') {
        setError('マイクの使用が許可されていません。');
      } else {
        setError(`音声認識エラー: ${code}`);
      }
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
      setInterimTranscript('');
    };

    mediaRecorderRef.current = null; // Mark as Web Speech mode
    recognition.start();
  }, [lang, startWhisperRecording]);

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
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== 'inactive'
      ) {
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

