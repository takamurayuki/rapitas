/**
 * codex-cli-spawn-argv tests
 *
 * Proves recoverCodexArgv returns the logical argv from what `spawn` received,
 * on both launch shapes (argv array on POSIX, one cmd.exe string on Windows),
 * by round-tripping the real buildCodexSpawnCommand.
 */
import { describe, expect, test } from 'bun:test';
import { buildCodexAuxArgs } from './codex-cli-args';
import { buildCodexSpawnCommand } from './codex-cli-runner';
import { recoverCodexArgv } from './codex-cli-spawn-argv';

const AWKWARD = [
  '--version',
  'login',
  'status',
  '-c',
  'forced_login_method="chatgpt"',
  'C:\\Users\\x\\tmp dir\\',
  '50% (done) & more | <x> ^ !',
  'say "hi" \\"there\\"',
];

describe('recoverCodexArgv', () => {
  for (const target of ['codex', 'codex.cmd', 'codex.exe']) {
    for (const isWindows of [false, true]) {
      test(`round-trips ${target} (isWindows=${isWindows})`, () => {
        const [command, args] = buildCodexSpawnCommand(target, AWKWARD, isWindows);
        expect(recoverCodexArgv(command, args)).toEqual(AWKWARD);
      });
    }
  }

  test('round-trips the real exec argv on the Windows launch shape', () => {
    const argv = buildCodexAuxArgs(
      'gpt-6-astra',
      'C:\\Users\\x\\AppData\\Local\\Temp\\codex-aux-1',
    );
    const [command, args] = buildCodexSpawnCommand('codex.cmd', argv, true);
    expect(args).toEqual([]); // the Windows shape hides argv inside one string
    expect(recoverCodexArgv(command, args)).toEqual(argv);
  });

  test('keeps an empty argv empty', () => {
    const [command, args] = buildCodexSpawnCommand('codex.cmd', [], true);
    expect(recoverCodexArgv(command, args)).toEqual([]);
  });
});
