/**
 * briefing-wav
 *
 * Pure PCM WAV helpers: measure real playback length from the header so the
 * 180-second cap is proven on actual audio, not on a character estimate.
 */

const HEADER_BYTES = 12;

/**
 * Read the duration of a PCM WAV buffer.
 *
 * @param wav - WAV file bytes / WAV バイト列
 * @returns Duration in seconds / 秒数
 * @throws {Error} When the RIFF/WAVE header, fmt or data chunk is missing / ヘッダ不正
 */
export function readWavDurationSeconds(wav: Uint8Array): number {
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = (o: number) => String.fromCharCode(...wav.slice(o, o + 4));
  if (wav.length < HEADER_BYTES || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') {
    throw new Error('Invalid WAV: missing RIFF/WAVE header');
  }
  let byteRate = 0;
  let offset = HEADER_BYTES;
  while (offset + 8 <= wav.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') {
      if (offset + 8 + 16 > wav.length) throw new Error('Invalid WAV: truncated fmt chunk');
      byteRate = view.getUint32(offset + 8 + 8, true);
    } else if (id === 'data') {
      if (byteRate <= 0) throw new Error('Invalid WAV: data chunk before fmt chunk');
      // Some encoders stream with size 0xFFFFFFFF; fall back to the real remainder.
      const dataBytes = Math.min(size, wav.length - (offset + 8));
      return dataBytes / byteRate;
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('Invalid WAV: no data chunk');
}

/**
 * Build a silent 8 kHz mono 16-bit PCM WAV (test fixture).
 *
 * @param seconds - Length in seconds / 秒数
 * @returns WAV bytes / WAV バイト列
 */
export function buildSilentWav(seconds: number): Uint8Array {
  const sampleRate = 8000;
  const byteRate = sampleRate * 2;
  const dataBytes = Math.round(seconds * byteRate);
  const out = new Uint8Array(44 + dataBytes);
  const v = new DataView(out.buffer);
  const put = (o: number, s: string) => [...s].forEach((c, i) => (out[o + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  v.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, byteRate, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  put(36, 'data');
  v.setUint32(40, dataBytes, true);
  return out;
}
