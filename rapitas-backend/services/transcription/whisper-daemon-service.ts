/**
 * Whisper Daemon Service
 *
 * Manages a persistent Whisper worker process that keeps the model in memory.
 * First transcription triggers model loading (~10-30s), subsequent calls are
 * fast (~1-3s) because the model is already loaded.
 *
 * Replaces the per-request subprocess spawning in whisper-local.ts.
 */
import { spawn, type ChildProcess } from 'child_process';
import { join } from 'path';
import { writeFileSync, unlinkSync, mkdirSync, existsSync } from 'fs';
import { createLogger } from '../../config';

const log = createLogger('transcription:whisper-daemon');

const DAEMON_PATH = join(__dirname, '../../workers/whisper-daemon.mjs');
const TEMP_DIR = join(__dirname, '../../data/temp-audio');

let daemon: ChildProcess | null = null;
let isReady = false;
let pendingRequests = new Map<
  string,
  { resolve: (text: string) => void; reject: (err: Error) => void }
>();
let requestCounter = 0;
let stdoutBuffer = '';
let stderrBuffer = ''; // line-buffer the daemon's stderr so partial chunks don't split messages
let suppressedStderrLines = 0;

/**
 * Decide whether a single line of daemon stderr is interesting enough to log.
 *
 * @xenova/transformers (the Whisper model loader) writes a lot of init noise
 * to stderr at startup — ONNX runtime warnings, download progress, layer
 * info, etc. — none of which is useful in normal operation. We only want to
 * see lines that come from the daemon itself (`[whisper-daemon] ...`) or that
 * look like genuine errors.
 */
function shouldLogStderrLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('[whisper-daemon]')) return true;
  return /\b(error|fail|fatal|exception|traceback)\b/i.test(trimmed);
}

/**
 * Start the Whisper daemon if not already running.
 * The daemon loads the model on first start and keeps it in memory.
 */
export function ensureDaemon(): Promise<void> {
  if (daemon && isReady) return Promise.resolve();
  if (daemon && !isReady) {
    // Still starting up — wait for ready signal
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Daemon startup timeout')), 120000);
      const check = setInterval(() => {
        if (isReady) {
          clearInterval(check);
          clearTimeout(timeout);
          resolve();
        }
      }, 500);
    });
  }

  return new Promise((resolve, reject) => {
    log.info('Starting Whisper daemon...');

    daemon = spawn('node', [DAEMON_PATH], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    daemon.stderr?.on('data', (data: Buffer) => {
      // NOTE: Line-buffer the chunk so a single transformers log entry that
      // arrives split across two `data` events doesn't get logged twice.
      stderrBuffer += data.toString();
      const lines = stderrBuffer.split('\n');
      stderrBuffer = lines.pop() ?? '';

      for (const line of lines) {
        if (shouldLogStderrLine(line)) {
          // Daemon-emitted lines and genuine errors get a real log entry.
          const isError = /\b(error|fail|fatal|exception|traceback)\b/i.test(line);
          if (isError) {
            log.warn({ msg: line.trim() }, 'Whisper daemon stderr');
          } else {
            log.info({ msg: line.trim() }, 'Whisper daemon stderr');
          }
        } else {
          // transformers init noise — count it but don't spam the log.
          suppressedStderrLines++;
        }
      }
    });

    daemon.stdout?.on('data', (data) => {
      stdoutBuffer += data.toString();

      // Process complete lines
      const lines = stdoutBuffer.split('\n');
      stdoutBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { id: string; text: string; error?: string };

          if (msg.id === '__ready__') {
            isReady = true;
            if (suppressedStderrLines > 0) {
              log.info(
                { suppressedStderrLines },
                `Whisper daemon ready (model loaded; ${suppressedStderrLines} init stderr lines suppressed)`,
              );
            } else {
              log.info('Whisper daemon ready (model loaded)');
            }
            resolve();
            continue;
          }

          const pending = pendingRequests.get(msg.id);
          if (pending) {
            pendingRequests.delete(msg.id);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.text);
            }
          }
        } catch {
          // Partial JSON or non-JSON line — ignore
        }
      }
    });

    daemon.on('close', (code) => {
      log.warn({ code }, 'Whisper daemon exited');
      daemon = null;
      isReady = false;

      // Reject all pending requests
      for (const [, pending] of pendingRequests) {
        pending.reject(new Error('Daemon exited'));
      }
      pendingRequests.clear();
    });

    daemon.on('error', (err) => {
      log.error({ err }, 'Whisper daemon spawn error');
      daemon = null;
      isReady = false;
      reject(err);
    });

    // Timeout for initial model loading
    setTimeout(() => {
      if (!isReady) {
        log.warn('Daemon startup taking long (model downloading?)');
      }
    }, 30000);
  });
}

/**
 * Transcribe audio using the persistent daemon.
 * Much faster than whisper-local.ts for repeated calls.
 *
 * @param audioBuffer - Raw audio data (WAV format) / 音声データ
 * @param language - Language hint / 言語ヒント
 * @returns Transcribed text / 文字起こしテキスト
 */
export async function transcribeFast(
  audioBuffer: Buffer | ArrayBuffer,
  language: string = 'ja',
): Promise<string> {
  await ensureDaemon();

  if (!existsSync(TEMP_DIR)) {
    mkdirSync(TEMP_DIR, { recursive: true });
  }

  const buffer = audioBuffer instanceof ArrayBuffer ? Buffer.from(audioBuffer) : audioBuffer;
  const tempPath = join(TEMP_DIR, `fast-${Date.now()}-${requestCounter}.wav`);
  writeFileSync(tempPath, buffer);

  const id = `req-${++requestCounter}`;

  try {
    const text = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error('Transcription timeout (30s)'));
      }, 30000);

      pendingRequests.set(id, {
        resolve: (text) => {
          clearTimeout(timeout);
          resolve(text);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      const request = JSON.stringify({ id, audioPath: tempPath, language }) + '\n';
      daemon?.stdin?.write(request);
    });

    return text;
  } finally {
    try {
      unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Stop the daemon process.
 */
export function stopDaemon(): void {
  if (daemon) {
    daemon.kill('SIGTERM');
    daemon = null;
    isReady = false;
    pendingRequests.clear();
  }
}

/**
 * Check if the daemon is running and ready.
 */
export function isDaemonReady(): boolean {
  return daemon !== null && isReady;
}
