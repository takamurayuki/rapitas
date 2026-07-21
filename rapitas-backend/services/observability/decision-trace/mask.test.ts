/**
 * mask.test.ts
 *
 * Unit tests for sensitive-data masking: key-name based, value-pattern based,
 * nested traversal, and circular-reference guarding.
 */
import { describe, it, expect } from 'bun:test';
import { maskSensitive, maskStringValue } from './mask';

describe('maskStringValue', () => {
  it('masks provider API key shapes inside strings', () => {
    const { masked, count } = maskStringValue(
      'key=sk-abcdefghijklmnopqrstuvwxyz123456 and pat=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123',
    );
    expect(masked).not.toContain('sk-abcdefghijklmnopqrstuvwxyz123456');
    expect(masked).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123');
    expect(masked).toContain('[REDACTED]');
    expect(count).toBe(2);
  });

  it('masks Bearer tokens and AWS access keys', () => {
    const { masked } = maskStringValue('Authorization: Bearer abc.def-ghi_1 / AKIAABCDEFGHIJKLMNOP');
    expect(masked).not.toContain('Bearer abc.def-ghi_1');
    expect(masked).not.toContain('AKIAABCDEFGHIJKLMNOP');
  });

  it('leaves ordinary strings untouched', () => {
    const { masked, count } = maskStringValue('複雑度70のためstandardモデルを推奨');
    expect(masked).toBe('複雑度70のためstandardモデルを推奨');
    expect(count).toBe(0);
  });
});

describe('maskSensitive', () => {
  it('redacts values under credential-like keys', () => {
    const { masked, maskedFieldCount } = maskSensitive({
      apiKey: 'plain-value',
      api_key: 'x',
      password: 'hunter2',
      Authorization: 'Basic abc',
      privateKey: 'pem',
      model: 'sonnet',
    });
    const obj = masked as Record<string, unknown>;
    expect(obj.apiKey).toBe('[REDACTED]');
    expect(obj.api_key).toBe('[REDACTED]');
    expect(obj.password).toBe('[REDACTED]');
    expect(obj.Authorization).toBe('[REDACTED]');
    expect(obj.privateKey).toBe('[REDACTED]');
    expect(obj.model).toBe('sonnet');
    expect(maskedFieldCount).toBe(5);
  });

  it('masks secret-shaped values in nested objects and arrays', () => {
    const { masked } = maskSensitive({
      nested: { note: 'uses sk-abcdefghijklmnopqrstuvwxyz' },
      list: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef0123', 'safe'],
    });
    const obj = masked as { nested: { note: string }; list: string[] };
    expect(obj.nested.note).toContain('[REDACTED]');
    expect(obj.list[0]).toBe('[REDACTED]');
    expect(obj.list[1]).toBe('safe');
  });

  it('preserves non-sensitive metadata (model names, costs, tradeoffs)', () => {
    const input = { modelId: 'claude-sonnet', estimatedCost: 0.42, tradeoff: 'バランス型' };
    const { masked, maskedFieldCount } = maskSensitive(input);
    expect(masked).toEqual(input);
    expect(maskedFieldCount).toBe(0);
  });

  it('does not mutate the original input', () => {
    const input = { apiKey: 'secret', keep: 'me' };
    maskSensitive(input);
    expect(input.apiKey).toBe('secret');
  });

  it('guards against circular references instead of looping forever', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    const { masked } = maskSensitive(a);
    const obj = masked as Record<string, unknown>;
    expect(obj.name).toBe('a');
    expect(obj.self).toBe('[Circular]');
  });

  it('passes through primitives and null unchanged', () => {
    expect(maskSensitive(null).masked).toBeNull();
    expect(maskSensitive(42).masked).toBe(42);
    expect(maskSensitive(true).masked).toBe(true);
  });
});
