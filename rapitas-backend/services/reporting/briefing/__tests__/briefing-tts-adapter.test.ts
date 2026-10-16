/**
 * briefing-tts-adapter.test
 *
 * Command selection (text never in argv) and the system TTS adapter's
 * success / failure / cleanup behaviour, driven by a fake runCommand.
 */
import { describe, it, expect, mock } from 'bun:test';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolveSpeechCommand } from '../briefing-speech-command';
import { createSystemTtsAdapter, getDefaultTtsAdapter } from '../briefing-tts-adapter';
import { buildSilentWav } from '../briefing-wav';

const SECRET = '秘密の台本テキスト; rm -rf / "$(x)"';

describe('resolveSpeechCommand', () => {
  for (const platform of ['win32', 'darwin', 'linux'] as const) {
    it(`${platform}: passes only file paths in argv`, () => {
      const cmd = resolveSpeechCommand(platform, '/tmp/in.txt', '/tmp/out.wav');
      expect(cmd.command.length).toBeGreaterThan(0);
      const joined = cmd.args.join('\n');
      expect(joined).toContain('/tmp/in.txt');
      expect(joined).toContain('/tmp/out.wav');
      expect(joined).not.toContain('秘密');
    });
  }
});

describe('createSystemTtsAdapter', () => {
  it('returns wav audio with measured seconds and removes temp files', async () => {
    const seen: { input: string; output: string }[] = [];
    const runCommand = mock(async (_c: string, args: string[]) => {
      const files = args.filter((a) => /briefing-tts-/.test(a));
      const input = files.find((f) => f.endsWith('.txt'))!;
      const output = files.find((f) => f.endsWith('.wav'))!;
      seen.push({ input, output });
      expect(readFileSync(input, 'utf8')).toBe(SECRET);
      writeFileSync(output, buildSilentWav(3));
    });
    const adapter = createSystemTtsAdapter({ runCommand, platform: 'linux' });
    const r = await adapter.synthesize(SECRET);
    expect(r).not.toBeNull();
    const audio = r as { data: Uint8Array; mime: string; seconds: number };
    expect(audio.mime).toBe('audio/wav');
    expect(audio.seconds).toBeCloseTo(3, 3);
    expect(runCommand.mock.calls[0][1].join(' ')).not.toContain('秘密');
    expect(existsSync(seen[0].input)).toBe(false);
    expect(existsSync(seen[0].output)).toBe(false);
  });
  it('throws when the command fails', async () => {
    const adapter = createSystemTtsAdapter({
      runCommand: async () => {
        throw new Error('exit 1');
      },
      platform: 'linux',
    });
    await expect(adapter.synthesize('x')).rejects.toThrow();
  });
  it('throws on empty output', async () => {
    const adapter = createSystemTtsAdapter({
      runCommand: async (_c, args) => {
        writeFileSync(args.find((a) => a.endsWith('.wav'))!, new Uint8Array(0));
      },
      platform: 'linux',
    });
    await expect(adapter.synthesize('x')).rejects.toThrow();
  });
  it('throws when the command produced no output file', async () => {
    const adapter = createSystemTtsAdapter({ runCommand: async () => {}, platform: 'linux' });
    await expect(adapter.synthesize('x')).rejects.toThrow();
  });
});

describe('getDefaultTtsAdapter', () => {
  it('is null when RAPITAS_BRIEFING_TTS=off', () => {
    process.env.RAPITAS_BRIEFING_TTS = 'off';
    expect(getDefaultTtsAdapter()).toBeNull();
    process.env.RAPITAS_BRIEFING_TTS = 'on';
    expect(getDefaultTtsAdapter()).not.toBeNull();
    delete process.env.RAPITAS_BRIEFING_TTS;
  });
});
