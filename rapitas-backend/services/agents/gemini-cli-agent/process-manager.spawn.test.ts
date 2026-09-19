/**
 * process-manager.spawn.test
 *
 * Covers the pure spawn-command builder exported by process-manager.ts:
 * `buildGeminiSpawnCommand` (task 977). No process is spawned by these
 * tests — they exercise a plain function extracted from spawnGeminiProcess's
 * former inline Windows branch. Mirrors
 * codex-cli-agent/process-runner.spawn.test.ts's buildSpawnCommand coverage.
 */
import { describe, test, expect } from 'bun:test';
import { buildGeminiSpawnCommand } from './process-manager';

/** Temporarily overrides process.platform for the duration of `fn`. */
function withPlatform<T>(platform: NodeJS.Platform, fn: () => T): T {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: original, configurable: true });
  }
}

describe('buildGeminiSpawnCommand', () => {
  test('non-Windows: passes command and args through unchanged', () => {
    withPlatform('linux', () => {
      const [command, args] = buildGeminiSpawnCommand('/usr/local/bin/gemini', [
        'exec',
        '--cd',
        'C:/work',
      ]);
      expect(command).toBe('/usr/local/bin/gemini');
      expect(args).toEqual(['exec', '--cd', 'C:/work']);
    });
  });

  test.each([
    [
      'wraps in a chcp 65001 prefix, quotes the command name for real, and caret-escapes each arg',
      ['exec', '--cd', 'C:/work'],
      'chcp 65001 >NUL 2>&1 && "gemini.cmd" ^^^"exec^^^" ^^^"--cd^^^" ^^^"C:/work^^^"',
    ],
    [
      'unconditionally quotes even simple args (no "does it need quoting" branch)',
      ['-p', '--output-format', 'json'],
      'chcp 65001 >NUL 2>&1 && "gemini.cmd" ^^^"-p^^^" ^^^"--output-format^^^" ^^^"json^^^"',
    ],
  ])('Windows: %s', (_desc, args, expectedCommand) => {
    withPlatform('win32', () => {
      const [command, finalArgs] = buildGeminiSpawnCommand('gemini.cmd', args);
      expect(command).toBe(expectedCommand);
      expect(finalArgs).toEqual([]);
    });
  });

  test('Windows: quotes the gemini path for real (not caret-escaped) so a space stays part of the name', () => {
    withPlatform('win32', () => {
      const [command] = buildGeminiSpawnCommand('C:/Program Files/gemini.cmd', ['-p']);
      expect(command).toContain('"C:/Program Files/gemini.cmd"');
      expect(command).not.toContain('^"C:/Program Files/gemini.cmd^"');
    });
  });

  test('Windows: caret-escapes args containing spaces, &, |, quotes, or newlines (double pass for the .cmd shim)', () => {
    withPlatform('win32', () => {
      const [command] = buildGeminiSpawnCommand('gemini.cmd', [
        'has space',
        'a&b',
        'a|b',
        'a\nb',
        'say "hi"',
      ]);
      expect(command).toContain('^^^"has space^^^"');
      expect(command).toContain('^^^"a^^^&b^^^"');
      expect(command).toContain('^^^"a^^^|b^^^"');
      expect(command).toContain('^^^"a\nb^^^"');
      expect(command).toContain('^^^"say \\^^^"hi\\^^^"^^^"');
    });
  });

  // task 977: the prior implementation special-cased '' -> '""' so cmd.exe
  // wouldn't collapse the empty value and consume the following flag as the
  // missing value. escapeWindowsShellArg's unconditional quoting already
  // produces a safely-quoted empty token, so this must keep working without
  // the special case.
  test('Windows: quotes an empty-string argument so it does not collapse in cmd.exe', () => {
    withPlatform('win32', () => {
      const [command] = buildGeminiSpawnCommand('gemini.cmd', ['-p', '', '--output-format']);
      expect(command).toContain('^^^"-p^^^" ^^^"^^^" ^^^"--output-format^^^"');
    });
  });
});
