/**
 * runtime-command-match.test
 *
 * The identity test behind every stop decision: quoting is honoured, and a
 * path that merely contains the recorded one never matches.
 */
import { describe, expect, test } from 'bun:test';
import { normalizeForMatch, sameArgv, tokenizeCommandLine } from './runtime-command-match';

describe('tokenizeCommandLine', () => {
  test('splits on whitespace and keeps quoted spaces and commas together', () => {
    expect(tokenizeCommandLine('node "C:/w/task-15 x,y/app.js" --port 8090')).toEqual([
      'node',
      'C:/w/task-15 x,y/app.js',
      '--port',
      '8090',
    ]);
  });

  test('an unterminated quote or an empty line yields null', () => {
    expect(tokenizeCommandLine('node "C:/w/app.js')).toBeNull();
    expect(tokenizeCommandLine('   ')).toBeNull();
    expect(tokenizeCommandLine('')).toBeNull();
  });

  test('an empty quoted argument is kept', () => {
    expect(tokenizeCommandLine('a "" b')).toEqual(['a', '', 'b']);
  });

  test.each([
    [String.raw`app "C:\dir\\" next`, ['app', 'C:\\dir\\', 'next']],
    [String.raw`app "a\"b" "a\\\"b"`, ['app', 'a"b', 'a\\"b']],
    ['app "a"" b" ""', ['app', 'a" b', '']],
  ])('Windowsの引用符とバックスラッシュを解く: %s', (command, expected) => {
    expect(tokenizeCommandLine(command as string, 'win32')).toEqual(expected);
  });

  test('POSIXの単引用符と二重引用符内の通常バックスラッシュを保持する', () => {
    expect(tokenizeCommandLine(String.raw`app 'a b,c' "a\q" escaped\ space`, 'linux')).toEqual([
      'app',
      'a b,c',
      'a\\q',
      'escaped space',
    ]);
  });

  test('POSIXの未完了エスケープと引用符は不明として返す', () => {
    expect(tokenizeCommandLine('app trailing\\', 'linux')).toBeNull();
    expect(tokenizeCommandLine("app 'unfinished", 'linux')).toBeNull();
  });

  test('Windowsでは空白とタブだけを区切りとして改行入り引数を別の引数列と一致させない', () => {
    expect(tokenizeCommandLine('app\tfirst second', 'win32')).toEqual(['app', 'first', 'second']);
    const recorded = tokenizeCommandLine('app first second', 'win32');
    const current = tokenizeCommandLine('app first\nsecond', 'win32');
    expect(current).toEqual(['app', 'first\nsecond']);
    expect(sameArgv(recorded, current)).toBe(false);
  });
});

describe('sameArgv', () => {
  const recorded = tokenizeCommandLine('"C:/w/task-15/app.exe" --serve');

  test('matches the same arguments regardless of slash style', () => {
    expect(sameArgv(recorded, tokenizeCommandLine('"C:\\w\\task-15\\app.exe" --serve'))).toBe(true);
    expect(sameArgv(recorded, tokenizeCommandLine('"C:/w/task-15/app.exe" --serve'))).toBe(true);
  });

  test.each([
    '"C:/w/task-15 x,y/app.exe" --serve',
    '"C:/w/task-153/app.exe" --serve',
    '"C:/w/task-15/app.exe" --serve --extra',
    '"C:/w/task-15/app.exe"',
    'prefix "C:/w/task-15/app.exe" --serve',
  ])('does not match %s', (command) => {
    expect(sameArgv(recorded, tokenizeCommandLine(command))).toBe(false);
  });

  test('null or empty argument lists never match, even each other', () => {
    expect(sameArgv(null, null)).toBe(false);
    expect(sameArgv([], [])).toBe(false);
    expect(sameArgv(recorded, null)).toBe(false);
  });

  test('通常引数の大文字小文字や末尾スラッシュの違いは一致と見なさない', () => {
    expect(sameArgv(['app', '--env=Production'], ['app', '--env=production'])).toBe(false);
    expect(sameArgv(['app', 'token/'], ['app', 'token'])).toBe(false);
  });
});

test('normalizeForMatch unifies separators and drops one trailing slash', () => {
  expect(normalizeForMatch('C:\\w\\task-15\\').replace(/^c:/i, 'C:')).toBe(
    process.platform === 'win32'
      ? 'C:/w/task-15'.toLowerCase().replace('c:', 'C:')
      : 'C:/w/task-15',
  );
});
