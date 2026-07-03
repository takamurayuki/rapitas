/**
 * speech-recognition-utils.test.ts
 *
 * transcribeAudioBlob のAPIエラー分岐、音声レベル計算・無音判定、WAV変換の
 * リサンプリング分岐、途中経過テキスト整形を検証する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transcribeAudioBlob,
  createAudioAnalyser,
  calculateAudioLevels,
  hasSound,
  convertToWav,
  formatInterimTranscript,
  SILENCE_CONFIG,
  BACKEND_URL,
} from '../common/speech-recognition-utils';

const mockEncodeWav = vi.fn();
const mockResamplePcm = vi.fn();
vi.mock('@/lib/audio/wav-codec', () => ({
  encodeWav: (...args: unknown[]) => mockEncodeWav(...args),
  resamplePcm: (...args: unknown[]) => mockResamplePcm(...args),
}));

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('transcribeAudioBlob', () => {
  const audioBlob = new Blob(['audio'], { type: 'audio/wav' });

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('成功時はtextを含む結果を返すこと', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'こんにちは', rawText: 'こんにちは。' }),
    });

    const result = await transcribeAudioBlob(audioBlob, 'ja', t);

    expect(result).toEqual({
      success: true,
      result: { text: 'こんにちは', rawText: 'こんにちは。' },
    });
    const [url, init] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${BACKEND_URL}/transcribe`);
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('HTTPエラー時はサーバのerrorメッセージを返すこと', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'audio too short' }),
    });

    const result = await transcribeAudioBlob(audioBlob, 'ja', t);

    expect(result).toEqual({ success: false, error: 'audio too short' });
  });

  it('HTTPエラーでJSONパースも失敗した場合は "Unknown error" を返すこと', async () => {
    // The source's own `.catch(() => ({ error: 'Unknown error' }))` on
    // response.json() supplies this fallback BEFORE the translator is consulted.
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => {
        throw new Error('invalid json');
      },
    });

    const result = await transcribeAudioBlob(audioBlob, 'ja', t);

    expect(result).toEqual({ success: false, error: 'Unknown error' });
  });

  it('HTTPエラーでerrorフィールドが無い場合も翻訳済みフォールバックを返すこと', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      json: async () => ({}),
    });

    const result = await transcribeAudioBlob(audioBlob, 'ja', t);

    expect(result).toEqual({ success: false, error: 'inputBar.transcribeFailed' });
  });
});

describe('createAudioAnalyser', () => {
  it('AudioContextからanalyserを生成し接続すること', () => {
    const mockConnect = vi.fn();
    const mockAnalyser = { fftSize: 0, connect: mockConnect };
    const mockSource = { connect: mockConnect };
    class MockAudioContext {
      createMediaStreamSource() {
        return mockSource;
      }
      createAnalyser() {
        return mockAnalyser;
      }
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    const stream = {} as MediaStream;
    const { audioCtx, analyser } = createAudioAnalyser(stream);

    expect(audioCtx).toBeInstanceOf(MockAudioContext);
    expect(analyser).toBe(mockAnalyser);
    expect(analyser.fftSize).toBe(2048);
    expect(mockSource.connect).toHaveBeenCalledWith(mockAnalyser);

    vi.unstubAllGlobals();
  });
});

describe('calculateAudioLevels', () => {
  it('周波数データの平均とRMSを計算すること', () => {
    const freqData = new Uint8Array([0, 10, 20, 30]);
    const timeData = new Float32Array([0.5, -0.5, 0.5, -0.5]);
    const analyser = {
      frequencyBinCount: freqData.length,
      fftSize: timeData.length,
      getByteFrequencyData: (arr: Uint8Array) => arr.set(freqData),
      getFloatTimeDomainData: (arr: Float32Array) => arr.set(timeData),
    } as unknown as AnalyserNode;

    const { freqAvg, rms } = calculateAudioLevels(analyser);

    expect(freqAvg).toBe(15); // (0+10+20+30)/4
    expect(rms).toBeCloseTo(0.5, 5); // sqrt(mean(0.25)) = 0.5
  });
});

describe('hasSound', () => {
  it('周波数平均が閾値を超えるとtrueを返すこと', () => {
    expect(hasSound(SILENCE_CONFIG.THRESHOLD + 1, 0)).toBe(true);
  });

  it('RMSが閾値を超えるとtrueを返すこと', () => {
    expect(hasSound(0, SILENCE_CONFIG.RMS_THRESHOLD + 0.001)).toBe(true);
  });

  it('両方とも閾値以下ならfalseを返すこと', () => {
    expect(hasSound(0, 0)).toBe(false);
  });
});

describe('convertToWav', () => {
  beforeEach(() => {
    mockEncodeWav.mockReset();
    mockResamplePcm.mockReset();
    mockEncodeWav.mockReturnValue(new Blob(['wav'], { type: 'audio/wav' }));
  });

  it('サンプルレートが既に16kHzならリサンプリングをスキップすること', async () => {
    const pcm = new Float32Array([0.1, 0.2, 0.3]);
    class MockAudioContext {
      async decodeAudioData() {
        return {
          sampleRate: 16000,
          getChannelData: () => pcm,
        };
      }
      async close() {}
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    const blob = new Blob(['raw'], { type: 'audio/webm' });
    blob.arrayBuffer = async () => new ArrayBuffer(8);

    await convertToWav(blob);

    expect(mockResamplePcm).not.toHaveBeenCalled();
    expect(mockEncodeWav).toHaveBeenCalledWith(pcm, 16000);

    vi.unstubAllGlobals();
  });

  it('サンプルレートが16kHz以外ならリサンプリングすること', async () => {
    const pcm = new Float32Array([0.1, 0.2, 0.3]);
    const resampled = new Float32Array([0.15, 0.25]);
    mockResamplePcm.mockReturnValue(resampled);

    class MockAudioContext {
      async decodeAudioData() {
        return {
          sampleRate: 44100,
          getChannelData: () => pcm,
        };
      }
      async close() {}
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    const blob = new Blob(['raw'], { type: 'audio/webm' });
    blob.arrayBuffer = async () => new ArrayBuffer(8);

    await convertToWav(blob);

    expect(mockResamplePcm).toHaveBeenCalledWith(pcm, 44100, 16000);
    expect(mockEncodeWav).toHaveBeenCalledWith(resampled, 16000);

    vi.unstubAllGlobals();
  });

  it('リサンプル結果がFloat32Array以外でも変換すること', async () => {
    const pcm = new Float32Array([0.1]);
    // Simulate a non-Float32Array return (defensive branch in convertToWav).
    mockResamplePcm.mockReturnValue([0.2, 0.3] as unknown as Float32Array);

    class MockAudioContext {
      async decodeAudioData() {
        return { sampleRate: 8000, getChannelData: () => pcm };
      }
      async close() {}
    }
    vi.stubGlobal('AudioContext', MockAudioContext);

    const blob = new Blob(['raw'], { type: 'audio/webm' });
    blob.arrayBuffer = async () => new ArrayBuffer(8);

    await convertToWav(blob);

    const encodedArg = mockEncodeWav.mock.calls[0][0] as Float32Array;
    expect(encodedArg).toBeInstanceOf(Float32Array);
    // Float32Array narrows precision (0.2 -> 0.20000000298023224), so compare
    // with tolerance rather than exact equality.
    expect(encodedArg.length).toBe(2);
    expect(encodedArg[0]).toBeCloseTo(0.2, 5);
    expect(encodedArg[1]).toBeCloseTo(0.3, 5);

    vi.unstubAllGlobals();
  });
});

describe('formatInterimTranscript', () => {
  it('発話検出前は listeningWithLevel を返すこと', () => {
    const result = formatInterimTranscript(t, false, 12.3, 0.045, 500);
    expect(result).toBe(
      `speechRecognitionHook.listeningWithLevel:${JSON.stringify({ freqAvg: '12', rms: '45' })}`,
    );
  });

  it('発話検出後は recordingWithLevel（無音秒数込み）を返すこと', () => {
    const result = formatInterimTranscript(t, true, 12.3, 0.045, 1500);
    expect(result).toBe(
      `speechRecognitionHook.recordingWithLevel:${JSON.stringify({
        freqAvg: '12',
        rms: '45',
        silenceSec: '1.5',
      })}`,
    );
  });
});
