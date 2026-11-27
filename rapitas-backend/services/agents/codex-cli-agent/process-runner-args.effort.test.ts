/**
 * process-runner-args — reasoning effort
 *
 * rapitas passed no reasoning effort to `codex exec`, so every run inherited
 * the effort in the user's own `~/.codex/config.toml`. That file was set to
 * `ultra` for interactive use, and all 748 rapitas Codex sessions of
 * 2026-11-20〜25 ran at it, exhausting the weekly plan limit before reset.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { buildCodexArgs, resolveCodexReasoningEffort } from './process-runner-args';

const ENV = 'RAPITAS_CODEX_REASONING_EFFORT';
const original = process.env[ENV];
afterEach(() => {
  if (original === undefined) delete process.env[ENV];
  else process.env[ENV] = original;
});

/** The value of the `-c model_reasoning_effort=…` override, or null. */
function effortArg(args: string[]): string | null {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] === '-c' && args[i + 1].startsWith('model_reasoning_effort=')) {
      return args[i + 1].slice('model_reasoning_effort='.length);
    }
  }
  return null;
}

const build = (config: Parameters<typeof buildCodexArgs>[0] = {}) =>
  buildCodexArgs(config, 'C:/work', 'prompt', '[test]').args;

describe('the reasoning effort rapitas asks Codex for', () => {
  test('is set explicitly, so the user config cannot raise it to ultra', () => {
    delete process.env[ENV];
    expect(effortArg(build())).toBe('high');
  });

  test('is set in investigation and resume runs too', () => {
    delete process.env[ENV];
    expect(effortArg(build({ investigationMode: true }))).toBe('high');
    expect(effortArg(build({ resumeSessionId: 'abc' }))).toBe('high');
  });

  test('sits before the resume subcommand, where exec options are read', () => {
    delete process.env[ENV];
    const args = build({ resumeSessionId: 'abc' });
    expect(args.indexOf('-c')).toBeLessThan(args.indexOf('resume'));
  });

  test('follows the environment override when it names a supported level', () => {
    process.env[ENV] = 'medium';
    expect(effortArg(build())).toBe('medium');
  });

  test('ignores an unsupported level instead of passing it on', () => {
    process.env[ENV] = 'ultra';
    expect(resolveCodexReasoningEffort()).toBe('high');
    process.env[ENV] = 'nonsense';
    expect(resolveCodexReasoningEffort()).toBe('high');
  });
});
