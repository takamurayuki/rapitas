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

  it('env var 未設定 → デフォルト 30000 を返す', () => {
    delete process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'];
    expect(getGitExecCacheTtlMs()).toBe(DEFAULT_TTL);
  });

  it('env var に正の整数 → その値を返す', () => {
    process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'] = '5000';
    expect(getGitExecCacheTtlMs()).toBe(5000);
  });

  it('env var が非数値 → デフォルト 30000 にフォールバック', () => {
    process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'] = 'abc';
    expect(getGitExecCacheTtlMs()).toBe(DEFAULT_TTL);
  });

  it("env var が '0' → デフォルト 30000 にフォールバック", () => {
    process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'] = '0';
    expect(getGitExecCacheTtlMs()).toBe(DEFAULT_TTL);
  });

  it('env var が負値 → デフォルト 30000 にフォールバック', () => {
    process.env['RAPITAS_GIT_EXEC_CACHE_TTL_MS'] = '-1';
    expect(getGitExecCacheTtlMs()).toBe(DEFAULT_TTL);
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

  it('env var 未設定 → デフォルト 30000 を返す', () => {
    delete process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'];
    expect(getGitRemoteCacheTtlMs()).toBe(DEFAULT_TTL);
  });

  it('env var に正の整数 → その値を返す', () => {
    process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'] = '8000';
    expect(getGitRemoteCacheTtlMs()).toBe(8000);
  });

  it('env var が非数値 → デフォルト 30000 にフォールバック', () => {
    process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'] = 'invalid';
    expect(getGitRemoteCacheTtlMs()).toBe(DEFAULT_TTL);
  });

  it("env var が '0' → デフォルト 30000 にフォールバック", () => {
    process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'] = '0';
    expect(getGitRemoteCacheTtlMs()).toBe(DEFAULT_TTL);
  });

  it('env var が負値 → デフォルト 30000 にフォールバック', () => {
    process.env['RAPITAS_GIT_REMOTE_CACHE_TTL_MS'] = '-100';
    expect(getGitRemoteCacheTtlMs()).toBe(DEFAULT_TTL);
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
