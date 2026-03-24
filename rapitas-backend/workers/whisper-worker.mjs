/**
 * Whisper Worker (Node.js ESM subprocess)
 *
 * Runs Whisper transcription via @xenova/transformers in a separate Node.js
 * process. Decodes WAV to Float32Array, preprocesses audio (normalize + trim
 * silence), then transcribes with the best available model.
 *
 * Input (stdin): JSON { audioPath: string, language?: string }
 * Output (stdout): JSON { text: string } or JSON { text: '', error: string }
 */

import { pipeline } from '@xenova/transformers';
import { readFileSync } from 'fs';

let transcriber = null;

// NOTE: Models listed best-first. First successful load is cached for subsequent calls.
// whisper-small: ~466MB, high Japanese accuracy
// whisper-base:  ~141MB, moderate accuracy
// whisper-tiny:  ~49MB, low accuracy (last resort)
const MODELS = ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-tiny'];

/**
 * Decode a 16-bit PCM WAV file into Float32Array.
 */
function decodeWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const bitsPerSample = view.getUint16(34, true);
  const numChannels = view.getUint16(22, true);
  const bytesPerSample = bitsPerSample / 8;

  let dataOffset = -1;
  let dataSize = 0;
  for (let i = 0; i < buffer.length - 8; i++) {
    if (buffer[i] === 0x64 && buffer[i+1] === 0x61 && buffer[i+2] === 0x74 && buffer[i+3] === 0x61) {
      dataSize = view.getUint32(i + 4, true);
      dataOffset = i + 8;
      break;
    }
  }

  if (dataOffset === -1) {
    throw new Error('WAV data chunk not found');
  }

  const numSamples = Math.floor(dataSize / (bytesPerSample * numChannels));
  const samples = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample * numChannels;
    if (offset + 1 >= buffer.length) break;
    const sample = view.getInt16(offset, true);
    samples[i] = sample / 32768;
  }

  return samples;
}

/**
 * Preprocess audio: normalize volume and trim leading/trailing silence.
 */
function preprocessAudio(samples) {
  // Trim silence from start and end (threshold: 0.005)
  const TRIM_THRESHOLD = 0.005;
  let start = 0;
  let end = samples.length - 1;

  while (start < end && Math.abs(samples[start]) < TRIM_THRESHOLD) start++;
  while (end > start && Math.abs(samples[end]) < TRIM_THRESHOLD) end--;

  // Add small padding (0.1s at 16kHz = 1600 samples)
  start = Math.max(0, start - 1600);
  end = Math.min(samples.length - 1, end + 1600);

  const trimmed = samples.slice(start, end + 1);

  // Normalize volume: scale to peak = 0.95
  let maxAbs = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const abs = Math.abs(trimmed[i]);
    if (abs > maxAbs) maxAbs = abs;
  }

  if (maxAbs > 0.001 && maxAbs < 0.95) {
    const scale = 0.95 / maxAbs;
    for (let i = 0; i < trimmed.length; i++) {
      trimmed[i] *= scale;
    }
  }

  return trimmed;
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  const { audioPath, language } = JSON.parse(input);

  if (!transcriber) {
    for (const model of MODELS) {
      try {
        process.stderr.write(`Loading model: ${model}\n`);
        transcriber = await pipeline('automatic-speech-recognition', model, {
          quantized: true,
        });
        process.stderr.write(`Model loaded: ${model}\n`);
        break;
      } catch {
        process.stderr.write(`Failed to load ${model}, trying next...\n`);
      }
    }
    if (!transcriber) {
      throw new Error('No Whisper model could be loaded');
    }
  }

  const fileBuffer = readFileSync(audioPath);
  let samples = decodeWav(fileBuffer);

  samples = preprocessAudio(samples);

  if (samples.length < 100) {
    process.stdout.write(JSON.stringify({ text: '', error: 'Audio too short' }));
    process.exit(0);
  }

  const result = await transcriber(samples, {
    language: language || 'ja',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  const text = typeof result === 'string' ? result : result.text || '';

  process.stdout.write(JSON.stringify({ text: text.trim() }));
  process.exit(0);
}

main().catch((err) => {
  process.stdout.write(JSON.stringify({ text: '', error: err.message }));
  process.exit(0);
});
