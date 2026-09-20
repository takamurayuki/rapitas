/**
 * gemini-runner-args.test
 *
 * Covers the pure buildSpawnCommand builder extracted from
 * gemini-cli-runner.ts (task #968). No process is spawned by these tests.
 */
import { describe, test, expect } from 'bun:test';
import { buildSpawnCommand } from './gemini-runner-args';

describe('buildSpawnCommand', () => {
  test('non-Windows: passes command and args through unchanged', () => {
    const [command, args] = buildSpawnCommand('/usr/local/bin/gemini', ['-p', 'do it'], false);
    expect(command).toBe('/usr/local/bin/gemini');
    expect(args).toEqual(['-p', 'do it']);
  });

  test('Windows: wraps in a chcp 65001 prefix, quotes the command name for real, and caret-escapes each arg', () => {
    const [command, finalArgs] = buildSpawnCommand(
      'gemini.cmd',
      ['-p', 'do it', '--output-format', 'stream-json'],
      true,
    );
    expect(command).toBe(
      'chcp 65001 >NUL 2>&1 && "gemini.cmd" ^^^"-p^^^" ^^^"do it^^^" ^^^"--output-format^^^" ^^^"stream-json^^^"',
    );
    expect(finalArgs).toEqual([]);
  });

  test('Windows: quotes the gemini path for real (not caret-escaped) so a space stays part of the name', () => {
    const [command] = buildSpawnCommand('C:/Program Files/gemini.cmd', ['-p', 'hi'], true);
    expect(command).toContain('"C:/Program Files/gemini.cmd"');
    expect(command).not.toContain('^"C:/Program Files/gemini.cmd^"');
  });

  test('Windows: シェルインジェクション再現テスト — メタ文字がキャレットエスケープされ生のまま現れない', () => {
    const [command] = buildSpawnCommand(
      'gemini.cmd',
      ['say "hi" & calc.exe', 'a|b', '%WINDIR%^&whoami', 'a<b>c', '(a);b,c', 'a!b'],
      true,
    );
    // 修正前は `&`/`|` のみ判定し他は素通りしていたため、以下のメタ文字が
    // 生のまま command 文字列に現れないことを確認する。
    expect(command).not.toContain('" & calc.exe"');
    expect(command).not.toContain('a|b');
    expect(command).not.toContain('%WINDIR%');
    expect(command).not.toContain('a<b>c');
    expect(command).not.toContain('(a);b,c');
    expect(command).toContain('^^^"say \\^^^"hi\\^^^" ^^^& calc.exe^^^"');
    expect(command).toContain('^^^"a^^^|b^^^"');
    expect(command).toContain('^^^"^^^%WINDIR^^^%^^^^^^^&whoami^^^"');
    expect(command).toContain('^^^"a^^^<b^^^>c^^^"');
    expect(command).toContain('^^^"^^^(a^^^)^^^;b^^^,c^^^"');
    expect(command).toContain('^^^"a^^^!b^^^"');
  });
});
