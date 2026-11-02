/**
 * restart-supervisor tests
 *
 * Pins which environments count as "something will relaunch us" (#1132).
 */
import { describe, test, expect } from 'bun:test';
import { hasRestartSupervisor } from './restart-supervisor';

describe('hasRestartSupervisor', () => {
  test.each([
    [{ TAURI_BUILD: 'true' }, true],
    [{ RAPITAS_RESTART_SUPERVISED: 'true' }, true],
    [{ TAURI_BUILD: 'true', RAPITAS_RESTART_SUPERVISED: 'true' }, true],
    [{}, false],
    [{ TAURI_BUILD: 'false' }, false],
    [{ RAPITAS_RESTART_SUPERVISED: '1' }, false],
    [{ RAPITAS_RESTART_SUPERVISED: 'TRUE' }, false],
  ])('%o → %p', (env, expected) => {
    expect(hasRestartSupervisor(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
