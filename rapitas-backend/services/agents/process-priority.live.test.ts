/**
 * process-priority.live.test
 *
 * Task 1553 repair: real child processes, no mocks. A command started through
 * spawnLowPriority / execFileLowPriority must report priority 10 (Windows
 * BELOW_NORMAL, POSIX nice 10) from its very first instruction, including a
 * grandchild started by a shell — the case the old "spawn, then setPriority(pid)"
 * order could not guarantee — and the backend's own priority must be unchanged
 * afterwards.
 *
 * The runner is first put at NORMAL priority (best effort; raising nice needs
 * privilege on POSIX) so a result of 10 cannot be inherited from the runner.
 */
import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import os from 'node:os';
import { spawnLowPriority, execFileLowPriority, LOW_PRIORITY } from './process-priority';

const SELF = process.pid;
let originalPriority = 0;
let startedAtNormal = false;

beforeAll(() => {
  originalPriority = os.getPriority(SELF);
  try {
    os.setPriority(SELF, 0);
  } catch {
    // Not allowed (POSIX without privilege): the assertions below still hold.
  }
  startedAtNormal = os.getPriority(SELF) === 0;
});

afterAll(() => {
  try {
    os.setPriority(SELF, originalPriority);
  } catch {
    /* best effort */
  }
});

const PRINT_PRIORITY = "console.log(require('os').getPriority())";

/** Runs a spawnLowPriority child to completion and returns its stdout. */
function runSpawn(command: string, args: string[], shell: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawnLowPriority(
      command,
      args,
      { shell, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
      'RAPITAS_VERIFY_QUIET',
      // Explicit platform: the NODE_ENV=test shortcut would skip the POSIX wrapper.
      { platform: process.platform },
    );
    let out = '';
    child.stdout?.on('data', (d: Buffer) => (out += d.toString()));
    child.on('error', reject);
    child.on('close', () => resolve(out.trim()));
  });
}

describe('children really are born at low priority (live)', () => {
  test('a direct child reports priority 10 and the backend priority is unchanged afterwards', async () => {
    const before = os.getPriority(SELF);
    const out = await runSpawn(process.execPath, ['-e', PRINT_PRIORITY], false);
    expect(Number(out)).toBe(LOW_PRIORITY);
    expect(os.getPriority(SELF)).toBe(before);
  });

  test('a grandchild started by a shell reports priority 10', async () => {
    const command = `"${process.execPath}" -e "${PRINT_PRIORITY}"`;
    const out = await runSpawn(command, [], true);
    expect(Number(out)).toBe(LOW_PRIORITY);
  });

  test('execFileLowPriority children also start low', async () => {
    const before = os.getPriority(SELF);
    const res = await execFileLowPriority(
      process.execPath,
      ['-e', PRINT_PRIORITY],
      { windowsHide: true },
      'RAPITAS_VERIFY_QUIET',
      { platform: process.platform },
    );
    expect(Number(res.stdout.trim())).toBe(LOW_PRIORITY);
    expect(os.getPriority(SELF)).toBe(before);
  });

  test('with the family flag off the child keeps the runner priority', async () => {
    process.env.RAPITAS_VERIFY_QUIET = 'off';
    try {
      const out = await runSpawn(process.execPath, ['-e', PRINT_PRIORITY], false);
      // Only meaningful when the runner itself is not already low.
      if (startedAtNormal) expect(Number(out)).not.toBe(LOW_PRIORITY);
      else expect(Number.isFinite(Number(out))).toBe(true);
    } finally {
      delete process.env.RAPITAS_VERIFY_QUIET;
    }
  });
});
