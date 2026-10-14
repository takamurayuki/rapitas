/**
 * briefing-delivery
 *
 * Generates, stores and announces one night briefing. The lock-screen
 * notification carries counts only; script text and audio are written to the
 * data directory and served by authenticated routes. Any failure degrades to
 * the plain-text notification instead of being swallowed.
 */
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { createLogger } from '../../../config/logger';
import { buildBriefingScript, renderScriptText } from './briefing-script-builder';
import { estimateSeconds, BRIEFING_MAX_CHARS, BRIEFING_MAX_SECONDS } from './briefing-duration';
import type { BriefingAudio, BriefingTtsAdapter } from './briefing-tts-adapter';
import type { BriefingInput, BriefingScript } from './briefing-types';

const log = createLogger('reporting:briefing-delivery');

/** Real-length resynthesis attempts before audio is abandoned. */
export const MAX_SYNTHESIS_ATTEMPTS = 5;
const SHRINK_FACTOR = 0.9;

/** Injected side effects (kept injectable so tests need no module mocks). */
export interface BriefingDeliveryDeps {
  dataDir: string;
  tts: BriefingTtsAdapter | null;
  /** Count-only notification sent when audio is ready. */
  notify: (p: {
    title: string;
    message: string;
    link?: string;
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  /** Plain-text fallback, called with a counts-only message. */
  fallbackNotify: (message: string) => Promise<void>;
  narrative?: string;
}

/** Outcome of {@link deliverBriefing}. */
export interface BriefingDeliveryResult {
  status: 'delivered' | 'script_only' | 'fallback' | 'skipped';
}

/** Stored script file shape. */
export interface StoredBriefing {
  script: BriefingScript;
  text: string;
  estimatedSeconds: number;
  hasAudio: boolean;
  /** File name under briefings/ and its MIME; absent in pre-WAV records (mp3). */
  audioFile?: string;
  audioMime?: string;
  /** Measured (or estimated when unmeasurable) playback seconds of the audio. */
  audioSeconds?: number;
  createdAt: string;
}

/**
 * Synthesize a script, shrinking and retrying while the REAL audio length is
 * over 180 s. Throws when it never fits, so callers fall back to text.
 */
async function synthesizeWithinLimit(
  input: BriefingInput,
  tts: BriefingTtsAdapter,
  narrative: string | undefined,
): Promise<{ script: BriefingScript; text: string; audio: BriefingAudio | null; seconds: number }> {
  let maxChars = BRIEFING_MAX_CHARS;
  for (let attempt = 1; attempt <= MAX_SYNTHESIS_ATTEMPTS; attempt++) {
    const script = buildBriefingScript(input, { narrative, maxChars });
    const text = renderScriptText(script);
    const raw = await tts.synthesize(text);
    if (!raw) return { script, text, audio: null, seconds: estimateSeconds(text) };
    const audio: BriefingAudio =
      raw instanceof Uint8Array ? { data: raw, mime: 'audio/mpeg' } : raw;
    const seconds = audio.seconds ?? estimateSeconds(text);
    if (seconds <= BRIEFING_MAX_SECONDS) return { script, text, audio, seconds };
    // Shrink below the length that just overran (speech rate is engine-dependent).
    maxChars = Math.floor(Math.min(maxChars, [...text].length) * SHRINK_FACTOR);
  }
  throw new Error(
    `Audio exceeded ${BRIEFING_MAX_SECONDS}s after ${MAX_SYNTHESIS_ATTEMPTS} attempts`,
  );
}

/** @returns Data root (RAPITAS_DATA_DIR or ~/.rapitas) / データルート */
export function resolveBriefingDataDir(): string {
  const o = process.env.RAPITAS_DATA_DIR;
  return o && o.trim() ? o : join(homedir(), '.rapitas');
}

/** @returns Paths of the script and audio files for a date / ファイルパス */
export function briefingPaths(dataDir: string, date: string) {
  const dir = join(dataDir, 'briefings');
  return { dir, json: join(dir, `${date}.json`), audio: join(dir, `${date}.mp3`) };
}

/**
 * Lock-screen-safe text: counts only, never titles, reasons or options.
 *
 * @param completed - Completed count / 完了件数
 * @param held - Held count / 保留・停止件数
 * @param decision - Decision count (0 or 1) / 要判断件数
 */
export function buildCountOnlyMessage(completed: number, held: number, decision: number): string {
  return `完了${completed}件 / 保留・停止${held}件 / 要判断${decision}件`;
}

/**
 * Deliver one briefing. Idempotent per date.
 *
 * @param input - Structured briefing input / 構造化入力
 * @param deps - Side-effect dependencies / 依存
 * @returns delivered | script_only | fallback | skipped / 配信結果
 */
export async function deliverBriefing(
  input: BriefingInput,
  deps: BriefingDeliveryDeps,
): Promise<BriefingDeliveryResult> {
  const paths = briefingPaths(deps.dataDir, input.date);
  if (existsSync(paths.json)) return { status: 'skipped' };

  const fallbackScript = buildBriefingScript(input, { narrative: deps.narrative });
  const { completed, held, decision } = fallbackScript.counts;
  const message = buildCountOnlyMessage(completed, held, decision);

  try {
    const { script, text, audio, seconds } = deps.tts
      ? await synthesizeWithinLimit(input, deps.tts, deps.narrative)
      : {
          script: fallbackScript,
          text: renderScriptText(fallbackScript),
          audio: null,
          seconds: 0,
        };
    await mkdir(paths.dir, { recursive: true });
    const audioFile = audio
      ? audio.mime === 'audio/wav'
        ? `${input.date}.wav`
        : `${input.date}.mp3`
      : undefined;
    if (audio && audioFile) await writeFile(join(paths.dir, audioFile), audio.data);
    const stored: StoredBriefing = {
      script,
      text,
      estimatedSeconds: estimateSeconds(text),
      hasAudio: audio !== null,
      audioFile,
      audioMime: audio?.mime,
      audioSeconds: audio ? seconds : undefined,
      createdAt: new Date().toISOString(),
    };
    await writeFile(paths.json, JSON.stringify(stored), 'utf8');
    if (!audio) return { status: 'script_only' };
    await deps.notify({
      title: `音声ブリーフィング ${input.date}`,
      message,
      link: input.linkUrl,
      metadata: {
        briefing: {
          date: input.date,
          audioSeconds: seconds,
          audioMime: audio.mime,
          counts: script.counts,
        },
      },
    });
    return { status: 'delivered' };
  } catch (err) {
    log.error({ err, date: input.date }, '[briefing] Audio generation failed — text fallback');
    // Acceptance criterion 4: a failed audio delivery must still reach the user as text.
    await deps.fallbackNotify(message);
    return { status: 'fallback' };
  }
}

/**
 * Read a stored briefing, or null when absent / unparsable.
 *
 * @param dataDir - Data root / データルート
 * @param date - YYYY-MM-DD
 */
export async function readStoredBriefing(
  dataDir: string,
  date: string,
): Promise<StoredBriefing | null> {
  try {
    return JSON.parse(await readFile(briefingPaths(dataDir, date).json, 'utf8')) as StoredBriefing;
  } catch {
    return null;
  }
}
