/**
 * git-retry-policy-registry.test
 *
 * Tests for the retry policy variant registry:
 * - GIT_RETRY_VARIANTS: correct type, known variant names
 * - default variant equals GIT_READ_RETRY_POLICY exactly
 * - resolveActiveGitRetryPolicy: env A→policy A / env B→policy B / unset→default / unknown→default
 * - getActiveVariantName: unknown env value triggers warn + falls back to "default"
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({
    info: mock(() => {}),
    debug: mock(() => {}),
    warn: mockWarn,
    error: mock(() => {}),
  }),
}));

const mockWarn = mock((..._args: unknown[]) => {});

// Import after mocks are set up.
const { GIT_RETRY_VARIANTS, resolveActiveGitRetryPolicy, getActiveVariantName } = await import(
  './git-retry-policy-registry'
);
const { GIT_READ_RETRY_POLICY } = await import('./git-exec');

// ─── GIT_RETRY_VARIANTS ───────────────────────────────────────────────────────

describe('GIT_RETRY_VARIANTS', () => {
  it('known variants: default, aggressive, conservative', () => {
    expect(Object.keys(GIT_RETRY_VARIANTS).sort()).toEqual(
      ['aggressive', 'conservative', 'default'].sort(),
    );
  });

  it('default variant は GIT_READ_RETRY_POLICY と完全一致', () => {
    const d = GIT_RETRY_VARIANTS['default'];
    expect(d.retryOn).toEqual(GIT_READ_RETRY_POLICY.retryOn);
    expect(d.maxRetries).toBe(GIT_READ_RETRY_POLICY.maxRetries);
    expect(d.baseDelay).toBe(GIT_READ_RETRY_POLICY.baseDelay);
    expect(d.maxDelay).toBe(GIT_READ_RETRY_POLICY.maxDelay);
  });

  it('各バリアントが必須フィールドを持つ', () => {
    for (const [name, policy] of Object.entries(GIT_RETRY_VARIANTS)) {
      expect(Array.isArray(policy.retryOn), `${name}.retryOn should be array`).toBe(true);
      expect(typeof policy.maxRetries, `${name}.maxRetries should be number`).toBe('number');
      expect(typeof policy.baseDelay, `${name}.baseDelay should be number`).toBe('number');
      expect(typeof policy.maxDelay, `${name}.maxDelay should be number`).toBe('number');
    }
  });

  it('aggressive は maxRetries が default より大きい', () => {
    expect(GIT_RETRY_VARIANTS['aggressive'].maxRetries).toBeGreaterThan(
      GIT_RETRY_VARIANTS['default'].maxRetries,
    );
  });

  it('conservative は maxRetries が default より小さい', () => {
    expect(GIT_RETRY_VARIANTS['conservative'].maxRetries).toBeLessThan(
      GIT_RETRY_VARIANTS['default'].maxRetries,
    );
  });
});

// ─── getActiveVariantName ──────────────────────────────────────────────────────

describe('getActiveVariantName', () => {
  const ENV_VAR = 'RAPITAS_GIT_RETRY_VARIANT';
  const original = process.env[ENV_VAR];

  beforeEach(() => {
    mockWarn.mockClear();
  });

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = original;
    }
  });

  it('未設定時は "default" を返す', () => {
    delete process.env[ENV_VAR];
    expect(getActiveVariantName()).toBe('default');
  });

  it('env=aggressive → "aggressive" を返す', () => {
    process.env[ENV_VAR] = 'aggressive';
    expect(getActiveVariantName()).toBe('aggressive');
  });

  it('env=conservative → "conservative" を返す', () => {
    process.env[ENV_VAR] = 'conservative';
    expect(getActiveVariantName()).toBe('conservative');
  });

  it('env=default → "default" を返す', () => {
    process.env[ENV_VAR] = 'default';
    expect(getActiveVariantName()).toBe('default');
  });

  it('未知バリアント → "default" を返す + warn を呼ぶ', () => {
    process.env[ENV_VAR] = 'unknown_variant_xyz';
    const name = getActiveVariantName();
    expect(name).toBe('default');
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });
});

// ─── resolveActiveGitRetryPolicy ─────────────────────────────────────────────

describe('resolveActiveGitRetryPolicy', () => {
  const ENV_VAR = 'RAPITAS_GIT_RETRY_VARIANT';
  const original = process.env[ENV_VAR];

  afterEach(() => {
    if (original === undefined) {
      delete process.env[ENV_VAR];
    } else {
      process.env[ENV_VAR] = original;
    }
    mockWarn.mockClear();
  });

  it('未設定 → default ポリシーを返す (GIT_READ_RETRY_POLICY と同値)', () => {
    delete process.env[ENV_VAR];
    const policy = resolveActiveGitRetryPolicy();
    expect(policy.maxRetries).toBe(GIT_READ_RETRY_POLICY.maxRetries);
    expect(policy.baseDelay).toBe(GIT_READ_RETRY_POLICY.baseDelay);
  });

  it('env=aggressive → aggressive ポリシーを返す', () => {
    process.env[ENV_VAR] = 'aggressive';
    const policy = resolveActiveGitRetryPolicy();
    expect(policy).toBe(GIT_RETRY_VARIANTS['aggressive']);
  });

  it('env=conservative → conservative ポリシーを返す', () => {
    process.env[ENV_VAR] = 'conservative';
    const policy = resolveActiveGitRetryPolicy();
    expect(policy).toBe(GIT_RETRY_VARIANTS['conservative']);
  });

  it('未知バリアント → default ポリシーを返す', () => {
    process.env[ENV_VAR] = 'nonexistent';
    const policy = resolveActiveGitRetryPolicy();
    expect(policy).toBe(GIT_RETRY_VARIANTS['default']);
  });
});
