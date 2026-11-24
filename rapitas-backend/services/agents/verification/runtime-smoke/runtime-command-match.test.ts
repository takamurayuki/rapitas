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
});

describe('sameArgv', () => {
  const recorded = tokenizeCommandLine('"C:/w/task-15/app.exe" --serve');

  test('matches the same arguments regardless of slash style', () => {
    expect(sameArgv(recorded, tokenizeCommandLine('"C:\\w\\task-15\\app.exe" --serve'))).toBe(
      process.platform === 'win32',
    );
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
});

test('normalizeForMatch unifies separators and drops one trailing slash', () => {
  expect(normalizeForMatch('C:\\w\\task-15\\').replace(/^c:/i, 'C:')).toBe(
    process.platform === 'win32'
      ? 'C:/w/task-15'.toLowerCase().replace('c:', 'C:')
      : 'C:/w/task-15',
  );
});
