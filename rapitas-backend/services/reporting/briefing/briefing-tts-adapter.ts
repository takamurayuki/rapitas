/**
 * briefing-tts-adapter
 *
 * Text-to-speech boundary. The default adapter drives the OS speech engine
 * (SAPI / say / espeak-ng) and measures the real WAV length; failures throw so
 * delivery can fall back to the text report instead of silently skipping.
 */
import { execFile } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { resolveSpeechCommand } from './briefing-speech-command';
import { readWavDurationSeconds } from './briefing-wav';

/** Encoded audio with its measured length. */
export interface BriefingAudio {
  data: Uint8Array;
  mime: string;
  /** Measured playback seconds; absent when the engine cannot measure. */
  seconds?: number;
}

/** A TTS engine. Returns audio, a bare byte buffer (legacy), or null for none. */
export interface BriefingTtsAdapter {
  synthesize(text: string): Promise<BriefingAudio | Uint8Array | null>;
}

/** Runs an external command; rejects on non-zero exit or timeout. */
export type RunCommand = (command: string, args: string[]) => Promise<void>;

const SYNTHESIS_TIMEOUT_MS = 60_000;

/** Default {@link RunCommand}: execFile with a hard timeout, no shell. */
export const defaultRunCommand: RunCommand = (command, args) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: SYNTHESIS_TIMEOUT_MS, windowsHide: true }, (err) =>
      err ? reject(err) : resolve(),
    );
  });

/** Options of {@link createSystemTtsAdapter}. */
export interface SystemTtsOptions {
  runCommand?: RunCommand;
  platform?: NodeJS.Platform;
}

/**
 * Create the OS speech adapter.
 *
 * @param options - Injectable command runner and platform / 注入可能な依存
 * @returns Adapter producing WAV audio / WAV を返すアダプタ
 */
export function createSystemTtsAdapter(options: SystemTtsOptions = {}): BriefingTtsAdapter {
  const runCommand = options.runCommand ?? defaultRunCommand;
  const platform = options.platform ?? process.platform;
  return {
    async synthesize(text: string): Promise<BriefingAudio> {
      const dir = await mkdtemp(join(tmpdir(), 'briefing-tts-'));
      try {
        const input = join(dir, 'script.txt');
        const output = join(dir, 'out.wav');
        await writeFile(input, text, 'utf8');
        const { command, args } = resolveSpeechCommand(platform, input, output);
        await runCommand(command, args);
        const data = new Uint8Array(await readFile(output));
        if (data.length === 0) throw new Error('TTS produced an empty file');
        // Throws on a malformed header, so a broken file is never delivered.
        const seconds = readWavDurationSeconds(data);
        return { data, mime: 'audio/wav', seconds };
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  };
}

let configured: BriefingTtsAdapter | null = null;

/**
 * Register an explicit engine (overrides the OS default).
 *
 * @param adapter - Engine or null to fall back to the default / エンジン
 */
export function setBriefingTtsAdapter(adapter: BriefingTtsAdapter | null): void {
  configured = adapter;
}

/**
 * The OS-detected adapter, or null when RAPITAS_BRIEFING_TTS=off. Under the
 * test runner (NODE_ENV=test) it is off unless RAPITAS_BRIEFING_TTS=on, so
 * unrelated suites never spawn a speech engine.
 *
 * @returns Adapter or null / アダプタまたは null
 */
export function getDefaultTtsAdapter(): BriefingTtsAdapter | null {
  const flag = process.env.RAPITAS_BRIEFING_TTS;
  if (flag === 'off') return null;
  if (flag !== 'on' && process.env.NODE_ENV === 'test') return null;
  return createSystemTtsAdapter();
}

/** @returns Explicit adapter, else the OS default / 使用するアダプタ */
export function getBriefingTtsAdapter(): BriefingTtsAdapter | null {
  return configured ?? getDefaultTtsAdapter();
}
