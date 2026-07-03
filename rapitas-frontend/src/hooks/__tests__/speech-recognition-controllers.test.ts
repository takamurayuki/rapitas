/* eslint-disable @typescript-eslint/no-this-alias -- test mocks capture the constructed instance via `x = this` in a constructor; benign in test fakes. */
/**
 * speech-recognition-controllers.test.ts
 *
 * sendForTranscription / startWhisperRecording / startWebSpeechAPI の各制御
 * フローを、React描画無しでコンテキストオブジェクト経由で検証する。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { MutableRefObject } from 'react';
import {
  sendForTranscription,
  startWhisperRecording,
  startWebSpeechAPI,
  type SpeechControllerContext,
} from '../common/speech-recognition-controllers';

const mockEncodeWav = vi.fn();
const mockResamplePcm = vi.fn();
vi.mock('@/lib/audio/wav-codec', () => ({
  encodeWav: (...args: unknown[]) => mockEncodeWav(...args),
  resamplePcm: (...args: unknown[]) => mockResamplePcm(...args),
}));

const mockCalculateAudioLevels = vi.fn();
const mockConvertToWav = vi.fn();
const mockCreateAudioAnalyser = vi.fn();
const mockFormatInterimTranscript = vi.fn();
const mockHasSound = vi.fn();
const mockTranscribeAudioBlob = vi.fn();
vi.mock('../common/speech-recognition-utils', async () => {
  const actual = await vi.importActual<typeof import('../common/speech-recognition-utils')>(
    '../common/speech-recognition-utils',
  );
  return {
    ...actual,
    calculateAudioLevels: (...args: unknown[]) => mockCalculateAudioLevels(...args),
    convertToWav: (...args: unknown[]) => mockConvertToWav(...args),
    createAudioAnalyser: (...args: unknown[]) => mockCreateAudioAnalyser(...args),
    formatInterimTranscript: (...args: unknown[]) => mockFormatInterimTranscript(...args),
    hasSound: (...args: unknown[]) => mockHasSound(...args),
    transcribeAudioBlob: (...args: unknown[]) => mockTranscribeAudioBlob(...args),
  };
});

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

function makeRef<T>(initial: T): MutableRefObject<T> {
  return { current: initial };
}

function makeContext(overrides: Partial<SpeechControllerContext> = {}): SpeechControllerContext {
  return {
    lang: 'ja-JP',
    t,
    setError: vi.fn(),
    setIsListening: vi.fn(),
    setIsTranscribing: vi.fn(),
    setTranscript: vi.fn(),
    setInterimTranscript: vi.fn(),
    setActiveStream: vi.fn(),
    setUseWhisperFallback: vi.fn(),
    streamRef: makeRef<MediaStream | null>(null),
    audioCtxRef: makeRef<AudioContext | null>(null),
    mediaRecorderRef: makeRef<MediaRecorder | null>(null),
    lastRawTextRef: makeRef(''),
    onResultRef: makeRef<((transcript: string) => void) | undefined>(undefined),
    ...overrides,
  };
}

describe('sendForTranscription', () => {
  beforeEach(() => {
    mockEncodeWav.mockReset().mockReturnValue(new Blob(['wav']));
    mockResamplePcm.mockReset();
    mockTranscribeAudioBlob.mockReset();
  });

  it('合計サンプル数が1600未満の場合は文字起こしせず短すぎるエラーを出すこと', async () => {
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(100)], 16000);

    expect(ctx.setError).toHaveBeenCalledWith('speechRecognitionHook.recordingTooShort');
    expect(ctx.setIsListening).toHaveBeenCalledWith(false);
    expect(mockTranscribeAudioBlob).not.toHaveBeenCalled();
  });

  it('ネイティブレートが16kHzならリサンプリングをスキップすること', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({ success: true, result: { text: 'hi' } });
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(2000)], 16000);

    expect(mockResamplePcm).not.toHaveBeenCalled();
  });

  it('ネイティブレートが16kHz以外ならリサンプリングすること', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({ success: true, result: { text: 'hi' } });
    mockResamplePcm.mockReturnValue(new Float32Array(2000));
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(2000)], 44100);

    expect(mockResamplePcm).toHaveBeenCalledWith(expect.any(Float32Array), 44100, 16000);
  });

  it('成功時はtranscriptへ追記しonResultを呼ぶこと', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({
      success: true,
      result: { text: 'こんにちは', rawText: 'こんにちは。' },
    });
    const onResult = vi.fn();
    const ctx = makeContext({ onResultRef: makeRef(onResult) });

    await sendForTranscription(ctx, [new Float32Array(2000)], 16000);

    expect(ctx.lastRawTextRef.current).toBe('こんにちは。');
    expect(onResult).toHaveBeenCalledWith('こんにちは');
    const updater = (ctx.setTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updater('prev-')).toBe('prev-こんにちは');
  });

  it('空文字の結果はtranscriptに追記しないこと', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({ success: true, result: { text: '   ' } });
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(2000)], 16000);

    expect(ctx.setTranscript).not.toHaveBeenCalled();
  });

  it('失敗結果はsetErrorへエラーメッセージを渡すこと', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({ success: false, error: 'server down' });
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(2000)], 16000);

    expect(ctx.setError).toHaveBeenCalledWith('server down');
  });

  it('transcribeAudioBlobが例外を投げた場合は接続エラーを出すこと', async () => {
    mockTranscribeAudioBlob.mockRejectedValue(new Error('network down'));
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(2000)], 16000);

    expect(ctx.setError).toHaveBeenCalledWith('speechRecognitionHook.transcribeConnectionFailed');
  });

  it('成功・失敗いずれでも最終的にisTranscribingをfalseへ戻すこと', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({ success: true, result: { text: 'ok' } });
    const ctx = makeContext();

    await sendForTranscription(ctx, [new Float32Array(2000)], 16000);

    expect(ctx.setIsTranscribing).toHaveBeenCalledWith(true);
    expect(ctx.setIsTranscribing).toHaveBeenCalledWith(false);
    expect(ctx.setInterimTranscript).toHaveBeenLastCalledWith('');
  });
});

describe('startWhisperRecording', () => {
  let mockStop: ReturnType<typeof vi.fn>;
  let mockTrack: { stop: ReturnType<typeof vi.fn> };
  let mockStream: { getTracks: () => { stop: ReturnType<typeof vi.fn> }[] };
  let mockAudioCtxClose: ReturnType<typeof vi.fn>;
  let recorderInstances: FakeMediaRecorder[] = [];

  class FakeMediaRecorder {
    static isTypeSupported = vi.fn().mockReturnValue(true);
    ondataavailable: ((e: { data: Blob }) => void) | null = null;
    onstop: (() => void) | null = null;
    start = vi.fn();
    stop: ReturnType<typeof vi.fn>;
    constructor(
      public stream: unknown,
      public options: unknown,
    ) {
      this.stop = vi.fn(() => this.onstop?.());
      recorderInstances.push(this);
    }
  }

  beforeEach(() => {
    recorderInstances = [];
    mockTrack = { stop: vi.fn() };
    mockStream = { getTracks: () => [mockTrack] };
    mockAudioCtxClose = vi.fn();
    mockStop = vi.fn();

    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(mockStream) },
    });
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);
    mockCreateAudioAnalyser.mockReset().mockReturnValue({
      audioCtx: { close: mockAudioCtxClose },
      analyser: {},
    });
    mockCalculateAudioLevels.mockReset().mockReturnValue({ freqAvg: 0, rms: 0 });
    mockHasSound.mockReset().mockReturnValue(false);
    mockFormatInterimTranscript.mockReset().mockReturnValue('listening...');
    mockConvertToWav.mockReset().mockResolvedValue(new Blob(['wav']));
    mockTranscribeAudioBlob.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('マイク取得に成功すると録音状態を開始すること', async () => {
    const ctx = makeContext();

    await startWhisperRecording(ctx);

    expect(ctx.setIsListening).toHaveBeenCalledWith(true);
    expect(ctx.setActiveStream).toHaveBeenCalledWith(mockStream);
    expect(ctx.streamRef.current).toBe(mockStream);
    expect(ctx.mediaRecorderRef.current).toBe(recorderInstances[0]);
    expect(recorderInstances[0].start).toHaveBeenCalledWith(500);
    void mockStop;
  });

  it('マイク許可が拒否された場合はmicPermissionDeniedを出すこと', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
    });
    const ctx = makeContext();

    await startWhisperRecording(ctx);

    expect(ctx.setError).toHaveBeenCalledWith('speechRecognitionHook.micPermissionDenied');
    expect(ctx.setIsListening).toHaveBeenCalledWith(false);
  });

  it('その他のマイクエラーはmicStartFailedを出すこと', async () => {
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error('device busy')) },
    });
    const ctx = makeContext();

    await startWhisperRecording(ctx);

    expect(ctx.setError).toHaveBeenCalledWith(
      'speechRecognitionHook.micStartFailed:{"message":"device busy"}',
    );
  });

  it('録音停止時、音声データが十分あれば文字起こしして追記すること', async () => {
    mockTranscribeAudioBlob.mockResolvedValue({
      success: true,
      result: { text: 'テスト', rawText: 'テスト。' },
    });
    const onResult = vi.fn();
    const ctx = makeContext({ onResultRef: makeRef(onResult) });

    await startWhisperRecording(ctx);
    const recorder = recorderInstances[0];
    const bigData = new Blob(['x'.repeat(600)]);
    recorder.ondataavailable?.({ data: bigData });

    await recorder.onstop?.();

    expect(mockConvertToWav).toHaveBeenCalled();
    expect(onResult).toHaveBeenCalledWith('テスト');
    expect(mockTrack.stop).toHaveBeenCalledTimes(1);
    expect(mockAudioCtxClose).toHaveBeenCalledTimes(1);
    expect(ctx.streamRef.current).toBeNull();
  });

  it('録音停止時、音声データが小さすぎる場合は短すぎるエラーを出すこと', async () => {
    const ctx = makeContext();

    await startWhisperRecording(ctx);
    const recorder = recorderInstances[0];
    // No ondataavailable calls -> empty blob, well under the 500-byte floor.

    await recorder.onstop?.();

    expect(ctx.setError).toHaveBeenCalledWith('speechRecognitionHook.recordingTooShort');
    expect(mockConvertToWav).not.toHaveBeenCalled();
  });

  it('convertToWavが失敗した場合はaudioProcessingErrorを出すこと', async () => {
    mockConvertToWav.mockRejectedValue(new Error('decode failed'));
    const ctx = makeContext();

    await startWhisperRecording(ctx);
    const recorder = recorderInstances[0];
    recorder.ondataavailable?.({ data: new Blob(['x'.repeat(600)]) });

    await recorder.onstop?.();

    expect(ctx.setError).toHaveBeenCalledWith(
      'speechRecognitionHook.audioProcessingError:{"message":"decode failed"}',
    );
  });

  it('無音がDURATION_MSを超えて続くと自動的に録音を停止すること', async () => {
    vi.useFakeTimers();
    const ctx = makeContext();

    await startWhisperRecording(ctx);
    const recorder = recorderInstances[0];

    // First tick: sound detected (marks hasSpoken + lastSoundTime).
    mockHasSound.mockReturnValueOnce(true);
    vi.advanceTimersByTime(100);

    // Subsequent ticks: silence: advance well past the 1500ms silence window.
    mockHasSound.mockReturnValue(false);
    vi.advanceTimersByTime(2000);

    expect(recorder.stop).toHaveBeenCalledTimes(1);
  });
});

describe('startWebSpeechAPI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Web Speech APIが無い場合はWhisperフォールバックへ切り替えること', () => {
    vi.stubGlobal('window', {});
    const ctx = makeContext();
    const startWhisperFallback = vi.fn();

    startWebSpeechAPI(ctx, startWhisperFallback);

    expect(ctx.setUseWhisperFallback).toHaveBeenCalledWith(true);
    expect(startWhisperFallback).toHaveBeenCalledTimes(1);
  });

  it('Web Speech APIがあればrecognitionを構成し開始すること', () => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
    }
    const instances: FakeRecognition[] = [];
    class TrackedRecognition extends FakeRecognition {
      constructor() {
        super();
        instances.push(this);
      }
    }
    vi.stubGlobal('window', { SpeechRecognition: TrackedRecognition });

    const ctx = makeContext();
    startWebSpeechAPI(ctx, vi.fn());

    const recognition = instances[0];
    expect(recognition.lang).toBe(ctx.lang);
    expect(recognition.continuous).toBe(true);
    expect(recognition.interimResults).toBe(true);
    expect(recognition.start).toHaveBeenCalledTimes(1);
    expect(ctx.mediaRecorderRef.current).toBeNull();

    recognition.onstart?.();
    expect(ctx.setIsListening).toHaveBeenCalledWith(true);

    recognition.onend?.();
    expect(ctx.setIsListening).toHaveBeenLastCalledWith(false);
    expect(ctx.setInterimTranscript).toHaveBeenLastCalledWith('');
  });

  it('onresultは確定テキストをtranscriptへ、暫定テキストをinterimへ振り分けること', () => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
    }
    let instance: FakeRecognition | null = null;
    class TrackedRecognition extends FakeRecognition {
      constructor() {
        super();
        instance = this;
      }
    }
    vi.stubGlobal('window', { SpeechRecognition: TrackedRecognition });

    const onResult = vi.fn();
    const ctx = makeContext({ onResultRef: makeRef(onResult) });
    startWebSpeechAPI(ctx, vi.fn());

    const results = [
      { 0: { transcript: '確定です' }, isFinal: true, length: 1 },
      { 0: { transcript: '暫定です' }, isFinal: false, length: 1 },
    ];
    (results as unknown as { length: number }).length = 2;
    instance!.onresult?.({ resultIndex: 0, results });

    expect(onResult).toHaveBeenCalledWith('確定です');
    expect(ctx.setInterimTranscript).toHaveBeenCalledWith('暫定です');
    const updater = (ctx.setTranscript as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(updater('prev-')).toBe('prev-確定です');
  });

  it.each(['no-speech', 'audio-capture', 'aborted'])(
    'onerrorが%sの場合はWhisperフォールバックへ切り替えること',
    (code) => {
      class FakeRecognition {
        lang = '';
        continuous = false;
        interimResults = false;
        onstart: (() => void) | null = null;
        onresult: ((e: unknown) => void) | null = null;
        onerror: ((e: unknown) => void) | null = null;
        onend: (() => void) | null = null;
        start = vi.fn();
        stop = vi.fn();
      }
      let instance: FakeRecognition | null = null;
      class TrackedRecognition extends FakeRecognition {
        constructor() {
          super();
          instance = this;
        }
      }
      vi.stubGlobal('window', { SpeechRecognition: TrackedRecognition });

      const ctx = makeContext();
      const startWhisperFallback = vi.fn();
      startWebSpeechAPI(ctx, startWhisperFallback);

      instance!.onerror?.({ error: code });

      expect(instance!.stop).toHaveBeenCalledTimes(1);
      expect(ctx.setUseWhisperFallback).toHaveBeenCalledWith(true);
      expect(ctx.setError).toHaveBeenCalledWith(null);
      expect(startWhisperFallback).toHaveBeenCalledTimes(1);
    },
  );

  it('onerrorが"not-allowed"の場合はmicPermissionDeniedを出すこと', () => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
    }
    let instance: FakeRecognition | null = null;
    class TrackedRecognition extends FakeRecognition {
      constructor() {
        super();
        instance = this;
      }
    }
    vi.stubGlobal('window', { SpeechRecognition: TrackedRecognition });

    const ctx = makeContext();
    startWebSpeechAPI(ctx, vi.fn());

    instance!.onerror?.({ error: 'not-allowed' });

    expect(ctx.setError).toHaveBeenCalledWith('speechRecognitionHook.micPermissionDenied');
    expect(ctx.setIsListening).toHaveBeenCalledWith(false);
  });

  it('未知のerrorコードはrecognitionErrorをコード付きで出すこと', () => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
    }
    let instance: FakeRecognition | null = null;
    class TrackedRecognition extends FakeRecognition {
      constructor() {
        super();
        instance = this;
      }
    }
    vi.stubGlobal('window', { SpeechRecognition: TrackedRecognition });

    const ctx = makeContext();
    startWebSpeechAPI(ctx, vi.fn());

    instance!.onerror?.({ error: 'network' });

    expect(ctx.setError).toHaveBeenCalledWith(
      'speechRecognitionHook.recognitionError:{"code":"network"}',
    );
    expect(ctx.setIsListening).toHaveBeenCalledWith(false);
  });

  it('errorコードが無い場合は"unknown"として扱うこと', () => {
    class FakeRecognition {
      lang = '';
      continuous = false;
      interimResults = false;
      onstart: (() => void) | null = null;
      onresult: ((e: unknown) => void) | null = null;
      onerror: ((e: unknown) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      stop = vi.fn();
    }
    let instance: FakeRecognition | null = null;
    class TrackedRecognition extends FakeRecognition {
      constructor() {
        super();
        instance = this;
      }
    }
    vi.stubGlobal('window', { SpeechRecognition: TrackedRecognition });

    const ctx = makeContext();
    startWebSpeechAPI(ctx, vi.fn());

    instance!.onerror?.({});

    expect(ctx.setError).toHaveBeenCalledWith(
      'speechRecognitionHook.recognitionError:{"code":"unknown"}',
    );
  });
});
