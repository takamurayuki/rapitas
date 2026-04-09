/**
 * wav-codec
 *
 * Pure utilities for converting browser-captured PCM audio (Float32Array
 * from `AudioBuffer.getChannelData(0)`) into a 16-bit mono WAV `Blob` ready
 * to upload to the transcription endpoint, plus a linear resampler so the
 * caller can normalize any source rate to the backend's expected 16 kHz.
 *
 * Originally duplicated in VoiceInputBar.tsx and useSpeechRecognition.ts;
 * extracted as part of the per-file size ratchet.
 */

/**
 * Encode a mono Float32 PCM buffer as a 16-bit RIFF/WAVE Blob.
 *
 * @param samples - Mono PCM samples in the range [-1, 1].
 * @param sampleRate - Sample rate of the input buffer in Hz.
 * @returns A `Blob` of MIME type `audio/wav` containing the encoded file.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const dataLength = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataLength, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/**
 * Linearly resample a Float32 PCM buffer from one sample rate to another.
 *
 * Cheap-and-cheerful linear interpolation — adequate for speech, not for
 * music. If `fromRate === toRate` the input array is returned unchanged.
 *
 * @param samples - Source PCM samples.
 * @param fromRate - Source sample rate in Hz.
 * @param toRate - Target sample rate in Hz.
 * @returns A new `Float32Array` at the target rate (or `samples` itself when no conversion is needed).
 */
export function resamplePcm(
  samples: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const outputLen = Math.floor(samples.length / ratio);
  const output = new Float32Array(outputLen);
  for (let i = 0; i < outputLen; i++) {
    const srcIdx = i * ratio;
    const idx = Math.floor(srcIdx);
    const frac = srcIdx - idx;
    if (idx + 1 < samples.length) {
      output[i] = samples[idx] * (1 - frac) + samples[idx + 1] * frac;
    } else if (idx < samples.length) {
      output[i] = samples[idx];
    }
  }
  return output;
}
