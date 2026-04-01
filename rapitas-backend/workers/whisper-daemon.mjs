/**
 * Whisper Daemon (Persistent Worker)
 *
 * Stays alive in memory with the Whisper model pre-loaded.
 * Accepts transcription requests via stdin (line-delimited JSON),
 * responds via stdout. Much faster than spawning a new process each time
 * because the model is already loaded.
 *
 * Protocol:
 *   Input:  {"id":"req-1","audioPath":"/path/to/audio.wav","language":"ja"}\n
 *   Output: {"id":"req-1","text":"こんにちは"}\n
 *   Or:     {"id":"req-1","text":"","error":"message"}\n
 */

import { pipeline } from '@xenova/transformers';
import { readFileSync } from 'fs';
import { createInterface } from 'readline';

let transcriber = null;
const MODELS = ['Xenova/whisper-small', 'Xenova/whisper-base', 'Xenova/whisper-tiny'];

/** Decode 16-bit PCM WAV to Float32Array. */
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
  if (dataOffset === -1) throw new Error('WAV data chunk not found');

  const numSamples = Math.floor(dataSize / (bytesPerSample * numChannels));
  const samples = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample * numChannels;
    if (offset + 1 >= buffer.length) break;
    samples[i] = view.getInt16(offset, true) / 32768;
  }
  return samples;
}

/** Normalize volume and trim silence. */
function preprocessAudio(samples) {
  const TRIM = 0.005;
  let start = 0, end = samples.length - 1;
  while (start < end && Math.abs(samples[start]) < TRIM) start++;
  while (end > start && Math.abs(samples[end]) < TRIM) end--;
  start = Math.max(0, start - 1600);
  end = Math.min(samples.length - 1, end + 1600);

  const trimmed = samples.slice(start, end + 1);
  let maxAbs = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (Math.abs(trimmed[i]) > maxAbs) maxAbs = Math.abs(trimmed[i]);
  }
  if (maxAbs > 0.001 && maxAbs < 0.95) {
    const scale = 0.95 / maxAbs;
    for (let i = 0; i < trimmed.length; i++) trimmed[i] *= scale;
  }
  return trimmed;
}

async function loadModel() {
  for (const model of MODELS) {
    try {
      process.stderr.write(`[whisper-daemon] Loading ${model}...\n`);
      transcriber = await pipeline('automatic-speech-recognition', model, { quantized: true });
      process.stderr.write(`[whisper-daemon] Model ready: ${model}\n`);
      return;
    } catch {
      process.stderr.write(`[whisper-daemon] Failed: ${model}\n`);
    }
  }
  throw new Error('No Whisper model could be loaded');
}

async function transcribe(audioPath, language) {
  const fileBuffer = readFileSync(audioPath);
  let samples = decodeWav(fileBuffer);
  samples = preprocessAudio(samples);

  if (samples.length < 100) return '';

  const result = await transcriber(samples, {
    language: language || 'ja',
    task: 'transcribe',
    chunk_length_s: 30,
    stride_length_s: 5,
  });

  return typeof result === 'string' ? result.trim() : (result.text || '').trim();
}

// --- Main ---

await loadModel();

// Signal readiness
process.stdout.write(JSON.stringify({ id: '__ready__', text: 'ready' }) + '\n');

// Process requests line by line
const rl = createInterface({ input: process.stdin });

rl.on('line', async (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }

  const { id, audioPath, language } = req;
  try {
    const text = await transcribe(audioPath, language);
    process.stdout.write(JSON.stringify({ id, text }) + '\n');
  } catch (err) {
    process.stdout.write(JSON.stringify({ id, text: '', error: err.message }) + '\n');
  }
});

// Keep alive
process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
