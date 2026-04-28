import { describe, it, expect } from 'vitest';
import { encodeWav, resamplePcm } from '../wav-codec';

describe('wav-codec', () => {
  describe('encodeWav', () => {
    it('戻り値がaudio/wav MIMEタイプのBlobである', () => {
      const samples = new Float32Array([0.5, -0.5, 0.0]);
      const sampleRate = 44100;
      const blob = encodeWav(samples, sampleRate);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/wav');
    });

    it('サイズが44 + samples.length * 2バイトになる', async () => {
      const samples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5]);
      const sampleRate = 16000;
      const blob = encodeWav(samples, sampleRate);

      const expectedSize = 44 + samples.length * 2; // WAVヘッダー44バイト + 16bit PCMデータ
      expect(blob.size).toBe(expectedSize);
    });

    it('RIFFヘッダーの先頭4文字がRIFFになる', async () => {
      const samples = new Float32Array([0.0, 0.5]);
      const sampleRate = 8000;
      const blob = encodeWav(samples, sampleRate);

      const arrayBuffer = await blob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // 先頭4バイトがRIFFかチェック
      const riffSignature = String.fromCharCode(
        view.getUint8(0),
        view.getUint8(1),
        view.getUint8(2),
        view.getUint8(3),
      );
      expect(riffSignature).toBe('RIFF');
    });

    it('12-15バイト目がWAVEになる', async () => {
      const samples = new Float32Array([0.1, -0.1]);
      const sampleRate = 22050;
      const blob = encodeWav(samples, sampleRate);

      const arrayBuffer = await blob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // 8-11バイト目がWAVEかチェック
      const waveSignature = String.fromCharCode(
        view.getUint8(8),
        view.getUint8(9),
        view.getUint8(10),
        view.getUint8(11),
      );
      expect(waveSignature).toBe('WAVE');
    });

    it('サンプルレートがヘッダーに正しく書き込まれる', async () => {
      const samples = new Float32Array([0.0]);
      const sampleRate = 48000;
      const blob = encodeWav(samples, sampleRate);

      const arrayBuffer = await blob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // オフセット24がサンプルレート
      const encodedSampleRate = view.getUint32(24, true); // little endian
      expect(encodedSampleRate).toBe(sampleRate);
    });

    it('サンプル値が[-1, 1]範囲外でクランプされる', async () => {
      // -1.5, 1.5 の範囲外の値を含むサンプル
      const samples = new Float32Array([-1.5, -1.0, 0.0, 1.0, 1.5]);
      const sampleRate = 16000;
      const blob = encodeWav(samples, sampleRate);

      const arrayBuffer = await blob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // PCMデータは44バイト目から開始
      const sample1 = view.getInt16(44, true); // -1.5 → -32768 (クランプ)
      const sample2 = view.getInt16(46, true); // -1.0 → -32768
      const sample3 = view.getInt16(48, true); // 0.0 → 0
      const sample4 = view.getInt16(50, true); // 1.0 → 32767
      const sample5 = view.getInt16(52, true); // 1.5 → 32767 (クランプ)

      expect(sample1).toBe(-32768); // -1.5がクランプされる
      expect(sample2).toBe(-32768); // -1.0
      expect(sample3).toBe(0); // 0.0
      expect(sample4).toBe(32767); // 1.0
      expect(sample5).toBe(32767); // 1.5がクランプされる
    });

    it('16bit PCM値の正負スケーリングが正しく行われる', async () => {
      // 正確な境界値をテスト
      const samples = new Float32Array([-1.0, -0.5, 0.0, 0.5, 1.0]);
      const sampleRate = 16000;
      const blob = encodeWav(samples, sampleRate);

      const arrayBuffer = await blob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      const sample1 = view.getInt16(44, true); // -1.0 * 0x8000 = -32768
      const sample2 = view.getInt16(46, true); // -0.5 * 0x8000 = -16384
      const sample3 = view.getInt16(48, true); // 0.0
      const sample4 = view.getInt16(50, true); // 0.5 * 0x7fff = 16383.5 → 16383
      const sample5 = view.getInt16(52, true); // 1.0 * 0x7fff = 32767

      expect(sample1).toBe(-32768);
      expect(sample2).toBe(-16384);
      expect(sample3).toBe(0);
      expect(sample4).toBe(16383);
      expect(sample5).toBe(32767);
    });

    it('dataチャンクのヘッダーが正しく書き込まれる', async () => {
      const samples = new Float32Array([0.1, 0.2]);
      const sampleRate = 44100;
      const blob = encodeWav(samples, sampleRate);

      const arrayBuffer = await blob.arrayBuffer();
      const view = new DataView(arrayBuffer);

      // オフセット36-39が"data"
      const dataSignature = String.fromCharCode(
        view.getUint8(36),
        view.getUint8(37),
        view.getUint8(38),
        view.getUint8(39),
      );
      expect(dataSignature).toBe('data');

      // オフセット40-43がデータサイズ
      const dataSize = view.getUint32(40, true);
      expect(dataSize).toBe(samples.length * 2); // 16bit = 2バイト/サンプル
    });
  });

  describe('resamplePcm', () => {
    it('fromRate === toRateのとき同一参照を返す', () => {
      const samples = new Float32Array([0.1, 0.2, 0.3]);
      const result = resamplePcm(samples, 44100, 44100);

      expect(result).toBe(samples); // 同一参照
    });

    it('ダウンサンプル（48kHz→16kHz）で長さが1/3になる', () => {
      // 48000 / 16000 = 3.0の比率
      const samples = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
      const result = resamplePcm(samples, 48000, 16000);

      const expectedLength = Math.floor(samples.length / 3); // 9/3 = 3
      expect(result.length).toBe(expectedLength);
    });

    it('アップサンプル（8kHz→16kHz）で長さが2倍になる', () => {
      // 8000 / 16000 = 0.5の比率
      const samples = new Float32Array([0.1, 0.2, 0.3, 0.4]);
      const result = resamplePcm(samples, 8000, 16000);

      const expectedLength = Math.floor(samples.length / 0.5); // 4/0.5 = 8
      expect(result.length).toBe(expectedLength);
    });

    it('線形補間が正しく行われる', () => {
      // 4サンプルを8サンプルにアップサンプル
      const samples = new Float32Array([0.0, 1.0, 0.0, -1.0]);
      const result = resamplePcm(samples, 2, 4); // 2:4の比率 = 0.5

      expect(result.length).toBe(8);

      // インデックス0: srcIdx=0*0.5=0, samples[0]=0.0
      expect(result[0]).toBeCloseTo(0.0);

      // インデックス1: srcIdx=1*0.5=0.5, 線形補間: samples[0]*(1-0.5) + samples[1]*0.5 = 0.0*0.5 + 1.0*0.5 = 0.5
      expect(result[1]).toBeCloseTo(0.5);

      // インデックス2: srcIdx=2*0.5=1.0, samples[1]=1.0
      expect(result[2]).toBeCloseTo(1.0);

      // インデックス3: srcIdx=3*0.5=1.5, 線形補間: samples[1]*0.5 + samples[2]*0.5 = 1.0*0.5 + 0.0*0.5 = 0.5
      expect(result[3]).toBeCloseTo(0.5);
    });

    it('境界ケース：最後のサンプルで補間相手がない場合', () => {
      // サンプル末尾での処理をテスト
      const samples = new Float32Array([1.0, 2.0]);
      const result = resamplePcm(samples, 1, 3); // 大きくアップサンプル

      // 出力長: Math.floor(2 / (1/3)) = Math.floor(6) = 6
      expect(result.length).toBe(6);

      // 最後のサンプル付近で境界処理が正しく行われているかチェック
      expect(result[result.length - 1]).toBeDefined();
      expect(Number.isNaN(result[result.length - 1])).toBe(false);
    });

    it('空のサンプル配列を正しく処理する', () => {
      const samples = new Float32Array([]);
      const result = resamplePcm(samples, 44100, 22050);

      expect(result.length).toBe(0);
      expect(result).toBeInstanceOf(Float32Array);
    });

    it('単一サンプルを正しく処理する', () => {
      const samples = new Float32Array([0.5]);
      const result = resamplePcm(samples, 44100, 22050);

      // 44100/22050 = 2.0の比率、Math.floor(1/2) = 0
      expect(result.length).toBe(0);
    });
  });
});
