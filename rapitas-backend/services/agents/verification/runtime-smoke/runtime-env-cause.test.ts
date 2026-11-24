/**
 * runtime-env-cause.test
 *
 * Launch-log signatures that mean a port or lock was taken are environment
 * causes, never an app defect.
 */
import { expect, test } from 'bun:test';
import { classifyLaunchLogCause } from './runtime-env-cause';

test.each([
  [['Error: listen EADDRINUSE: address already in use :::8090'], 'port_in_use'],
  [['Port 3000 is in use, trying another one'], 'port_in_use'],
  [['別のインスタンスが既に起動しています'], 'lock_held'],
  [['Another next dev server is already running.'], 'lock_held'],
  [['TypeError: x is not a function'], undefined],
  [[], undefined],
])('%j classifies as %s', (logs, cause) => {
  expect(classifyLaunchLogCause(logs)).toBe(cause);
});
