/**
 * Local Whisper Transcription Service
 *
 * Runs OpenAI Whisper via @xenova/transformers locally — no API key required.
 * Uses a Node.js subprocess (whisper-worker.cjs) for Bun compatibility,
 * following the same pattern as embedding-worker.cjs.
 */
import { spawn } from 'child_process';
import { join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { createLogger } from '../../config';

const log = createLogger('transcription:whisper-local');

const WORKER_PATH = join(__dirname, '../../workers/whisper-worker.mjs');
const TEMP_DIR = join(__dirname, '../../data/temp-audio');

/** Transcription result from local Whisper. */
export interface LocalTranscriptionResult {
  text: string;
  error?: string;
}

/**
 * Transcribe an audio buffer using the local Whisper model.
 *
 * Writes the audio to a temp file, spawns a Node.js subprocess running
 * whisper-worker.cjs, and returns the transcribed text.
 *
 * @param audioBuffer - Raw audio data (webm, wav, etc.) / 音声データ
 * @param language - Language hint (default: 'ja') / 言語ヒント
 * @returns Transcription result / 文字起こし結果
 */
export async function transcribeLocal(
  audioBuffer: Buffer | ArrayBuffer,
  language: string = 'ja',
): Promise<LocalTranscriptionResult> {
  // Ensure temp directory exists
  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const tempPath = join(TEMP_DIR, `whisper-${Date.now()}.wav`);

  try {
    // Write audio to temp file
    const buffer = audioBuffer instanceof ArrayBuffer ? Buffer.from(audioBuffer) : audioBuffer;
    writeFileSync(tempPath, buffer);

    // Log file header for debugging format issues
    const header = buffer.slice(0, 4).toString('ascii');
    log.info(
      { audioSize: buffer.length, header, language },
      'Starting local Whisper transcription',
    );

    const result = await runWhisperWorker(tempPath, language);

    log.info({ textLength: result.text.length }, 'Local transcription completed');

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ err: error }, 'Local Whisper transcription failed');
    return { text: '', error: message };
  } finally {
    // Cleanup temp file
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Run the whisper-worker.cjs subprocess.
 *
 * @param audioPath - Path to the audio file / 音声ファイルパス
 * @param language - Language hint / 言語ヒント
 * @returns Worker output / ワーカー出力
 */
function runWhisperWorker(audioPath: string, language: string): Promise<LocalTranscriptionResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [WORKER_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // NOTE: Manual timeout — spawn's timeout option only works with execFile.
    // First run downloads model (~466MB) and loads ONNX, so allow generous time.
    const timeoutHandle = setTimeout(() => {
      child.kill();
      reject(new Error('Whisper worker timed out (5 min). Model may still be downloading.'));
    }, 300000);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timeoutHandle);
      // NOTE: ONNX Runtime writes warnings to stderr even on success.
      // Only treat as error if exit code is non-zero AND stdout has no valid JSON.
      if (stderr.length > 0) {
        log.debug({ stderr: stderr.slice(0, 300) }, 'Whisper worker stderr (may be warnings)');
      }

      // Try to parse stdout first — if it has valid JSON, the worker succeeded
      // regardless of exit code (ONNX warnings can cause non-zero exit).
      if (stdout.trim().length > 0) {
        try {
          const result = JSON.parse(stdout) as LocalTranscriptionResult & { error?: string };
          if (result.error) {
            reject(new Error(result.error));
            return;
          }
          resolve({ text: result.text });
          return;
        } catch {
          // stdout is not valid JSON — fall through to error handling
        }
      }

      if (code !== 0) {
        // Check if stderr contains a JSON error from our worker
        try {
          const parsed = JSON.parse(stderr);
          reject(new Error(parsed.error || `Worker exited with code ${code}`));
        } catch {
          reject(new Error(`Whisper worker failed (code ${code}): ${stderr.slice(0, 200)}`));
        }
        return;
      }

      try {
        const result = JSON.parse(stdout) as LocalTranscriptionResult;
        resolve(result);
      } catch {
        reject(new Error('Failed to parse Whisper worker output'));
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to spawn Whisper worker: ${err.message}`));
    });

    // Send input to worker
    child.stdin.write(JSON.stringify({ audioPath, language }));
    child.stdin.end();
  });
}
