/**
 * runtime-env-cause.test
 *
 * A launch log is an environment cause ONLY when the launch never became ready
 * and the LAST fatal message is the port/lock conflict. Anything a recovered
 * launch or a different error says afterwards stays an implementation failure.
 */
import { describe, expect, test } from 'bun:test';
import { classifyEnvCause } from './runtime-env-cause';

const LOCK_REFUSAL = '別のインスタンスが既に起動しています';
const classify = (lines: string[], reachedReady = false, exitedBeforeReady?: boolean) =>
  classifyEnvCause({ text: lines.join('\n'), reachedReady, exitedBeforeReady });

describe('classifyEnvCause — environment causes', () => {
  // NOTE: 準備完了前の自主終了と単独行の完全一致で、Error: のない起動拒否を確定できる。
  test('準備完了前に単独行を出して自主終了した場合はロック競合', () => {
    expect(
      classify([`  ${LOCK_REFUSAL}\r`, 'ELIFECYCLE Command failed with exit code 1'], false, true),
    ).toBe('lock_held');
  });

  test.each([
    [['Error: listen EADDRINUSE: address already in use :::8090'], 'port_in_use'],
    [['Error: Port 8090 in use'], 'port_in_use'],
    [['Error: ポート 8090 は使用中です'], 'port_in_use'],
    [['Error: 別のインスタンスが既に起動しています'], 'lock_held'],
    [['Error: Another next dev server is already running.'], 'lock_held'],
    [['Unable to acquire lock at .next/dev/lock'], 'lock_held'],
    [['Error: the workspace is locked by pid 12'], 'lock_held'],
    [["Error: EBUSY: resource busy or locked, open '/w/.next/dev/lock'"], 'lock_held'],
    [["Error: EBUSY: resource busy or locked, open 'C:\\w\\.next\\dev\\lock'"], 'lock_held'],
    [['Error: lock held by another process'], 'lock_held'],
  ])('%j is %s', (lines, cause) => {
    expect(classify(lines)).toBe(cause);
  });

  test('the stack trace of the conflict error stays one fatal message', () => {
    expect(
      classify([
        'Error: listen EADDRINUSE: address already in use :::8090',
        '    at Server.setupListenHandle [as _listen2] (node:net:1)',
        '    at listenInCluster (node:net:1)',
      ]),
    ).toBe('port_in_use');
  });
});

describe('classifyEnvCause — a negated readiness mention is not readiness', () => {
  test.each(['the app is not ready', 'waiting for the server to be ready', 'never became ready'])(
    '%s before the conflict still classifies it',
    (line) => {
      expect(classify([line, 'Error: listen EADDRINUSE: address already in use :::8090'])).toBe(
        'port_in_use',
      );
    },
  );
});

describe('classifyEnvCause — never an environment cause', () => {
  test('recovery A: a port conflict followed by a ready server and then a TypeError', () => {
    expect(
      classify([
        'Port 3000 is in use, trying 3001 instead',
        'Ready in 1.2s',
        'TypeError: x is not a function',
        '    at handler (app.ts:1:1)',
      ]),
    ).toBeNull();
  });

  test('a launch that reached readiness is never environmental, whatever the log says', () => {
    expect(classify(['Error: listen EADDRINUSE: address already in use :::8090'], true)).toBeNull();
  });

  test.each([
    'Listening on port 3002',
    'Local: http://127.0.0.1:3002',
    'started server on 0.0.0.0',
  ])('a ready marker (%s) before the conflict message disqualifies it', (marker) => {
    expect(classify([marker, 'Error: listen EADDRINUSE: address already in use'])).toBeNull();
  });

  test('A2: a conflict warning followed by a different fatal error', () => {
    expect(
      classify(['Error: listen EADDRINUSE: address already in use :::3000', 'TypeError: boom']),
    ).toBeNull();
  });

  test.each([
    ['Failed to parse lock file: Unexpected token'],
    ['Error: invalid configuration (lock file)'],
    ['Error: lock file is corrupt'],
  ])('B: %s mentions a lock but nothing holds it', (line) => {
    expect(classify([line])).toBeNull();
  });

  test('C: both a port and a lock expression is ambiguous', () => {
    expect(
      classify(['Error: listen EADDRINUSE: address already in use', 'Unable to acquire lock']),
    ).toBeNull();
  });

  test.each([
    "Error: EBUSY: resource busy or locked, rename 'a.txt' -> 'b.txt'",
    'Error: EBUSY: resource busy or locked',
    "Error: EBUSY: resource busy or locked, unlink '/w/src/blocked.ts'",
  ])('D: a generic EBUSY (%s) does not prove a held launch lock', (line) => {
    expect(classify([line])).toBeNull();
  });

  test('no fatal message at all cannot be judged', () => {
    expect(classify(['compiling...', 'still compiling'])).toBeNull();
    expect(classify([])).toBeNull();
  });

  test.each([
    [
      'Warning: Port 8090 is in use, trying 8091 instead',
      'build-worker terminated with exit code 2',
    ],
    ['TypeError: x is not a function', 'Warning: Port 8090 is in use, trying 8091 instead'],
    ['Error: listen EADDRINUSE', 'build-worker terminated with exit code 2'],
    ['Error: workspace is locked', 'build-worker terminated with exit code -1'],
    ['TypeError: x is not a function', 'Warning: another instance is already running'],
  ])('致命的エラーを競合への言及で上書きしない: %s → %s', (first, last) => {
    expect(classify([first, last])).toBeNull();
  });

  test.each([
    'Warning: Port 8090 is in use, trying 8091 instead',
    'Port 8090 in use',
    'ポート 8090 は使用中です',
    'Another next dev server is already running.',
    '    at EADDRINUSE (app.ts:1:1)',
  ])('致命的メッセージがない競合への言及は原因にしない: %s', (line) => {
    expect(classify([line])).toBeNull();
  });

  test.each([
    ['準備完了ログ', ['Ready in 1.2s', LOCK_REFUSAL]],
    ['警告', [`Warning: ${LOCK_REFUSAL}`]],
    ['部分一致', [`${LOCK_REFUSAL}（再試行します）`]],
    ['後続の致命行', [LOCK_REFUSAL, 'TypeError: boom']],
    ['後続の解析エラー', [LOCK_REFUSAL, 'Failed to parse lock file: Unexpected token']],
    ['ポート競合との混在', ['Error: listen EADDRINUSE', LOCK_REFUSAL]],
  ])('自主終了時も%sを伴うログには原因を付けない', (_name, lines) => {
    expect(classify(lines, false, true)).toBeNull();
  });

  test('自主終了の証拠がない単独行には原因を付けない', () => {
    expect(classify([LOCK_REFUSAL])).toBeNull();
  });

  test('準備完了の事実を自主終了の情報より優先する', () => {
    expect(classify([LOCK_REFUSAL], true, true)).toBeNull();
  });

  test.each([
    'ELIFECYCLE Command failed with exit code 1',
    'build-worker completed with exit code 0',
  ])('異常終了を示さない補助行は最後の致命的原因を変えない: %s', (line) => {
    expect(classify(['Error: listen EADDRINUSE', line])).toBe('port_in_use');
  });
});
