/**
 * speech-recognition-controllers
 *
 * Recording/recognition control flows extracted from the speech recognition
 * hook: PCM-chunk transcription, Whisper recording with silence detection, and
 * the Web Speech API path with Whisper fallback. These are plain functions that
 * operate on a context of React state setters and refs supplied by the hook.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { encodeWav, resamplePcm } from '@/lib/audio/wav-codec';
import type {
  SpeechRecognitionEvent,
  SpeechRecognitionErrorEvent,
} from './speech-recognition.types';
import {
  SILENCE_CONFIG,
  calculateAudioLevels,
  convertToWav,
  createAudioAnalyser,
  formatInterimTranscript,
  hasSound,
  transcribeAudioBlob,
  type SpeechTranslator,
} from './speech-recognition-utils';

/**
 * Shared context for the recording controllers: the hook's state setters and
 * mutable refs plus the active language.
 */
export interface SpeechControllerContext {
  lang: string;
  /** Translator scoped to `voice`, threaded down from `useSpeechRecognition`. / `voice` にスコープした翻訳関数 */
  t: SpeechTranslator;
  setError: Dispatch<SetStateAction<string | null>>;
  setIsListening: Dispatch<SetStateAction<boolean>>;
  setIsTranscribing: Dispatch<SetStateAction<boolean>>;
  setTranscript: Dispatch<SetStateAction<string>>;
  setInterimTranscript: Dispatch<SetStateAction<string>>;
  setActiveStream: Dispatch<SetStateAction<MediaStream | null>>;
  setUseWhisperFallback: Dispatch<SetStateAction<boolean>>;
  streamRef: MutableRefObject<MediaStream | null>;
  audioCtxRef: MutableRefObject<AudioContext | null>;
  mediaRecorderRef: MutableRefObject<MediaRecorder | null>;
  lastRawTextRef: MutableRefObject<string>;
  onResultRef: MutableRefObject<((transcript: string) => void) | undefined>;
}

/**
 * Send recorded PCM chunks as WAV to backend for transcription.
 *
 * @param ctx - Hook state context / フック状態コンテキスト
 * @param pcmChunks - Recorded PCM audio chunks / 録音されたPCM音声チャンク
 * @param nativeSampleRate - Source sample rate in Hz / 元のサンプルレート(Hz)
 */
export async function sendForTranscription(
  ctx: SpeechControllerContext,
  pcmChunks: Float32Array[],
  nativeSampleRate: number,
): Promise<void> {
  const totalLength = pcmChunks.reduce((sum, c) => sum + c.length, 0);
  if (totalLength < 1600) {
    ctx.setError(ctx.t('speechRecognitionHook.recordingTooShort'));
    ctx.setIsListening(false);
    return;
  }

  // Merge PCM chunks
  const merged = new Float32Array(totalLength);
  let off = 0;
  for (const chunk of pcmChunks) {
    merged.set(chunk, off);
    off += chunk.length;
  }

  const resampled =
    nativeSampleRate === 16000 ? merged : resamplePcm(merged, nativeSampleRate, 16000);
  const wavBlob = encodeWav(resampled, 16000);

  ctx.setIsTranscribing(true);
  ctx.setInterimTranscript(ctx.t('inputBar.recognizing'));

  try {
    const result = await transcribeAudioBlob(wavBlob, ctx.lang.split('-')[0], ctx.t);
    if (result.success && result.result.text.trim()) {
      ctx.lastRawTextRef.current = result.result.rawText || result.result.text;
      ctx.setTranscript((prev) => prev + result.result.text);
      ctx.onResultRef.current?.(result.result.text);
    } else if (!result.success) {
      ctx.setError(result.error);
    }
  } catch {
    ctx.setError(ctx.t('speechRecognitionHook.transcribeConnectionFailed'));
  } finally {
    ctx.setIsTranscribing(false);
    ctx.setInterimTranscript('');
  }
}

/**
 * Record audio with automatic silence detection.
 * Auto-sends for transcription when silence is detected for 1.5 seconds.
 *
 * @param ctx - Hook state context / フック状態コンテキスト
 */
export async function startWhisperRecording(ctx: SpeechControllerContext): Promise<void> {
  try {
    ctx.setError(null);
    ctx.setInterimTranscript(ctx.t('inputBar.listening'));

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    ctx.streamRef.current = stream;
    ctx.setActiveStream(stream);

    const { audioCtx, analyser } = createAudioAnalyser(stream);

    const mediaRecorder = new MediaRecorder(stream, {
      mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm',
    });
    const chunks: Blob[] = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };

    // Silence detection state
    const silenceState = { lastSoundTime: 0, hasSpoken: false, sent: false };

    const silenceCheckInterval = setInterval(() => {
      if (silenceState.sent) {
        clearInterval(silenceCheckInterval);
        return;
      }

      const { freqAvg, rms } = calculateAudioLevels(analyser);
      const soundDetected = hasSound(freqAvg, rms);

      if (soundDetected) {
        silenceState.lastSoundTime = Date.now();
        silenceState.hasSpoken = true;
      }

      const silenceMs =
        silenceState.lastSoundTime > 0 ? Date.now() - silenceState.lastSoundTime : 0;
      ctx.setInterimTranscript(
        formatInterimTranscript(ctx.t, silenceState.hasSpoken, freqAvg, rms, silenceMs),
      );

      // Auto-send after silence following speech
      if (
        silenceState.hasSpoken &&
        silenceState.lastSoundTime > 0 &&
        silenceMs > SILENCE_CONFIG.DURATION_MS
      ) {
        silenceState.sent = true;
        clearInterval(silenceCheckInterval);
        mediaRecorder.stop();
      }
    }, SILENCE_CONFIG.CHECK_INTERVAL_MS);

    mediaRecorder.onstop = async () => {
      // Cleanup resources
      stream.getTracks().forEach((track) => track.stop());
      ctx.streamRef.current = null;
      ctx.setActiveStream(null);
      audioCtx.close();
      ctx.audioCtxRef.current = null;
      ctx.mediaRecorderRef.current = null;

      const audioBlob = new Blob(chunks, { type: 'audio/webm' });
      if (audioBlob.size < 500) {
        ctx.setError(ctx.t('speechRecognitionHook.recordingTooShort'));
        ctx.setIsListening(false);
        return;
      }

      // Process and transcribe
      ctx.setIsTranscribing(true);
      ctx.setIsListening(false);
      ctx.setInterimTranscript(ctx.t('inputBar.recognizing'));

      try {
        const wavBlob = await convertToWav(audioBlob);
        const result = await transcribeAudioBlob(wavBlob, ctx.lang.split('-')[0], ctx.t);

        if (result.success && result.result.text.trim()) {
          ctx.lastRawTextRef.current = result.result.rawText || result.result.text;
          ctx.setTranscript((prev) => prev + result.result.text);
          ctx.onResultRef.current?.(result.result.text);
        } else if (!result.success) {
          ctx.setError(result.error);
        }
      } catch (decodeErr) {
        ctx.setError(
          ctx.t('speechRecognitionHook.audioProcessingError', {
            message: decodeErr instanceof Error ? decodeErr.message : 'Unknown',
          }),
        );
      } finally {
        ctx.setIsTranscribing(false);
        ctx.setInterimTranscript('');
      }
    };

    mediaRecorder.start(500);
    ctx.audioCtxRef.current = audioCtx;
    ctx.mediaRecorderRef.current = mediaRecorder;
    ctx.setIsListening(true);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (message.includes('Permission') || message.includes('NotAllowed')) {
      ctx.setError(ctx.t('speechRecognitionHook.micPermissionDenied'));
    } else {
      ctx.setError(ctx.t('speechRecognitionHook.micStartFailed', { message }));
    }
    ctx.setIsListening(false);
  }
}

/**
 * Try Web Speech API first. If it fails with no-speech, switch to Whisper.
 *
 * @param ctx - Hook state context / フック状態コンテキスト
 * @param startWhisperFallback - Callback to start Whisper recording / Whisper録音を開始するコールバック
 */
export function startWebSpeechAPI(
  ctx: SpeechControllerContext,
  startWhisperFallback: () => void,
): void {
  const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognitionAPI) {
    // No Web Speech API — go directly to Whisper
    ctx.setUseWhisperFallback(true);
    startWhisperFallback();
    return;
  }

  ctx.setError(null);
  ctx.setInterimTranscript('');

  const recognition = new SpeechRecognitionAPI();
  recognition.lang = ctx.lang;
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => ctx.setIsListening(true);

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
      ctx.setTranscript((prev) => prev + final);
      ctx.onResultRef.current?.(final);
    }
    ctx.setInterimTranscript(interim);
  };

  recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
    const code = event.error || 'unknown';
    if (code === 'no-speech' || code === 'audio-capture' || code === 'aborted') {
      // NOTE: Web Speech API failed — switch to Whisper fallback for this session.
      recognition.stop();
      ctx.setUseWhisperFallback(true);
      ctx.setError(null);
      startWhisperFallback();
      return;
    }
    if (code === 'not-allowed') {
      ctx.setError(ctx.t('speechRecognitionHook.micPermissionDenied'));
    } else {
      ctx.setError(ctx.t('speechRecognitionHook.recognitionError', { code }));
    }
    ctx.setIsListening(false);
  };

  recognition.onend = () => {
    ctx.setIsListening(false);
    ctx.setInterimTranscript('');
  };

  ctx.mediaRecorderRef.current = null; // Mark as Web Speech mode
  recognition.start();
}
