/**
 * dependency-preflight.test
 *
 * A pull that changes rapitas-backend/bun.lock is only safe to activate if
 * dev.js can reinstall it with the pinned bun. If it cannot, the restart that
 * follows the pull would come back on node_modules that do not match the code
 * (the 2026-10-16 Tauri bump failure, on the backend side). These tests pin
 * that the gate refuses exactly that case, before the pull, and names itself.
 */
import { describe, expect, test } from 'bun:test';
import {
  checkDependencyToolchain,
  readPinnedBunVersion,
  DEPENDENCY_LOCKFILES,
} from './dependency-preflight';

describe('checkDependencyToolchain', () => {
  test('no lockfile in the change set → no blocker', () => {
    expect(checkDependencyToolchain(['rapitas-frontend/src/app/page.tsx'], '1.4.0', '1.3.13')).toBe(
      null,
    );
  });

  test('bun.lock changed and the running bun is the pin → no blocker', () => {
    expect(checkDependencyToolchain(['rapitas-backend/bun.lock'], '1.3.13', '1.3.13')).toBe(null);
  });

  test('bun.lock changed and the running bun is not the pin → refused, named', () => {
    expect(checkDependencyToolchain(['rapitas-backend/bun.lock'], '1.4.0', '1.3.13')).toBe(
      'dependency-toolchain-mismatch',
    );
  });

  test('pin unreadable with bun.lock changed → refused (unknown is not safe)', () => {
    expect(checkDependencyToolchain(['rapitas-backend/bun.lock'], '1.3.13', null)).toBe(
      'dependency-toolchain-mismatch',
    );
  });

  // pnpm lockfiles are installed through `npx pnpm@<pin>` and the root one by
  // `npm ci`; neither depends on what is on PATH, so neither can be refused here.
  test('pnpm / npm lockfiles alone never block', () => {
    expect(
      checkDependencyToolchain(
        ['rapitas-desktop/pnpm-lock.yaml', 'rapitas-frontend/pnpm-lock.yaml', 'package-lock.json'],
        '1.4.0',
        '1.3.13',
      ),
    ).toBe(null);
  });

  test('knows all four lockfiles dev.js syncs', () => {
    expect([...DEPENDENCY_LOCKFILES].sort()).toEqual([
      'package-lock.json',
      'rapitas-backend/bun.lock',
      'rapitas-desktop/pnpm-lock.yaml',
      'rapitas-frontend/pnpm-lock.yaml',
    ]);
  });
});

describe('readPinnedBunVersion', () => {
  test('reads the pin from .github/toolchain.json', () => {
    expect(readPinnedBunVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
