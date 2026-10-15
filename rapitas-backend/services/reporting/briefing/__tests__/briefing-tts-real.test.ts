/**
 * briefing-tts-real.test
 *
 * Real speech synthesis on Windows (SAPI via powershell.exe): proves a WAV is
 * actually produced and its measured length is within the 180 s cap. Skipped
 * on other platforms, where command building and the length loop are covered
 * by the fake-runner suites.
 */
import { describe, it, expect } from 'bun:test';
import { createSystemTtsAdapter } from '../briefing-tts-adapter';
import type { BriefingAudio } from '../briefing-tts-adapter';
import { BRIEFING_MAX_SECONDS } from '../briefing-duration';

const isWindows = process.platform === 'win32';

describe.skipIf(!isWindows)('system TTS (real, win32)', () => {
  it('synthesizes a short script to a WAV within 180 seconds', async () => {
    const adapter = createSystemTtsAdapter();
    const audio = (await adapter.synthesize(
      '2026年10月14日の夜間実行結果です。完了2件、保留1件、要判断1件。',
    )) as BriefingAudio;
    expect(audio.mime).toBe('audio/wav');
    expect(audio.data.length).toBeGreaterThan(44);
    expect(audio.seconds).toBeGreaterThan(0);
    expect(audio.seconds).toBeLessThanOrEqual(BRIEFING_MAX_SECONDS);
  }, 90_000);
});
