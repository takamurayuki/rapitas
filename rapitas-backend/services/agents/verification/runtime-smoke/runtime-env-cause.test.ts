/**
 * runtime-env-cause.test
 *
 * A launch log is an environment cause ONLY when the launch never became ready
 * and the LAST fatal message is the port/lock conflict. Anything a recovered
 * launch or a different error says afterwards stays an implementation failure.
 */
import { describe, expect, test } from 'bun:test';
import { classifyEnvCause } from './runtime-env-cause';

const classify = (lines: string[], reachedReady = false) =>
  classifyEnvCause({ text: lines.join('\n'), reachedReady });

describe('classifyEnvCause — environment causes', () => {
  test.each([
    [['Error: listen EADDRINUSE: address already in use :::8090'], 'port_in_use'],
    [['Port 8090 in use'], 'port_in_use'],
    [['ポート 8090 は使用中です'], 'port_in_use'],
    [['別のインスタンスが既に起動しています'], 'lock_held'],
    [['Another next dev server is already running.'], 'lock_held'],
    [['Unable to acquire lock at .next/dev/lock'], 'lock_held'],
    [['Error: the workspace is locked by pid 12'], 'lock_held'],
    [['Error: EBUSY: resource busy or locked'], 'lock_held'],
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

  test('no fatal message at all cannot be judged', () => {
    expect(classify(['compiling...', 'still compiling'])).toBeNull();
    expect(classify([])).toBeNull();
  });
});
