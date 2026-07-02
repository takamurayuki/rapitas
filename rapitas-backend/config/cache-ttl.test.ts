/**
 * cache-ttl.test
 *
 * Unit tests for config/cache-ttl.ts:
 * - getGitExecCacheTtlMs: env var unset, valid value, invalid values (non-numeric / 0 / negative)
 * - getGitRemoteCacheTtlMs: same matrix as above for the remote variant
 * - GIT_CACHE_ENABLED: default (true) — module-load-time evaluation cannot be toggled
 *   without bun mock.module re-import; the '0' branch is covered by the export contract.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { getGitExecCacheTtlMs, getGitRemoteCacheTtlMs, GIT_CACHE_ENABLED } from './cache-ttl';

const DEFAULT_TTL = 30_000;

// ─── getGitExecCacheTtlMs ─────────────────────────────────────────────────────

describe('getGitExecCacheTtlMs', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'];
    } else {
      process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'] = original;
    }
  });

  it.each([
    { label: '未設定 → デフォルト 30000 を返す', value: undefined, expected: DEFAULT_TTL },
    { label: 'に正の整数 → その値を返す', value: '5000', expected: 5000 },
    { label: 'が非数値 → デフォルト 30000 にフォールバック', value: 'abc', expected: DEFAULT_TTL },
    { label: "が '0' → デフォルト 30000 にフォールバック", value: '0', expected: DEFAULT_TTL },
    { label: 'が負値 → デフォルト 30000 にフォールバック', value: '-1', expected: DEFAULT_TTL },
  ])('env var $label', ({ value, expected }) => {
    if (value === undefined) {
      delete process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'];
    } else {
      process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'] = value;
    }
    expect(getGitExecCacheTtlMs()).toBe(expected);
  });
});

// ─── getGitRemoteCacheTtlMs ───────────────────────────────────────────────────

describe('getGitRemoteCacheTtlMs', () => {
  let original: string | undefined;

  beforeEach(() => {
    original = process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'];
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'];
    } else {
      process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'] = original;
    }
  });

  it.each([
    { label: '未設定 → デフォルト 30000 を返す', value: undefined, expected: DEFAULT_TTL },
    { label: 'に正の整数 → その値を返す', value: '8000', expected: 8000 },
    {
      label: 'が非数値 → デフォルト 30000 にフォールバック',
      value: 'invalid',
      expected: DEFAULT_TTL,
    },
    { label: "が '0' → デフォルト 30000 にフォールバック", value: '0', expected: DEFAULT_TTL },
    { label: 'が負値 → デフォルト 30000 にフォールバック', value: '-100', expected: DEFAULT_TTL },
  ])('env var $label', ({ value, expected }) => {
    if (value === undefined) {
      delete process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'];
    } else {
      process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'] = value;
    }
    expect(getGitRemoteCacheTtlMs()).toBe(expected);
  });
});

// ─── GIT_CACHE_ENABLED ────────────────────────────────────────────────────────

describe('GIT_CACHE_ENABLED', () => {
  it('デフォルト（RAPITAS_GIT_EXEC_CACHE 未設定）では true', () => {
    // NOTE: GIT_CACHE_ENABLED is evaluated at module load time. In the test
    // environment RAPITAS_GIT_EXEC_CACHE is not set to '0', so the exported
    // constant is true. Testing the '0' branch requires a process restart or
    // bun mock.module re-import (bun limitation — process-global module cache).
    expect(GIT_CACHE_ENABLED).toBe(true);
  });
});
