/**
 * temperature-guard.test
 *
 * Locks the determinism guarantee for the direct-SDK Anthropic path: the
 * wrapper enforces temperature 0 ONLY for models that still accept the param,
 * and OMITS it for the Claude 5 / Opus 4.7-4.8 / Sonnet 5 family (which 400 on
 * any temperature). This asserts the model-aware predicate that gates that
 * behavior — the pure guarantee, without heavy SDK request mocking.
 */
import { describe, it, expect } from 'bun:test';
import { modelAcceptsTemperature } from './agent';

describe('modelAcceptsTemperature — temperature determinism guard', () => {
  it('returns true for older models that still accept temperature', () => {
    expect(modelAcceptsTemperature('claude-sonnet-4-20250514')).toBe(true);
    expect(modelAcceptsTemperature('claude-3-5-haiku-20241022')).toBe(true);
    expect(modelAcceptsTemperature('claude-opus-4-20250514')).toBe(true);
    expect(modelAcceptsTemperature('claude-opus-4-6')).toBe(true);
  });

  it('returns false for the Claude 5 / Opus 4.7-4.8 / Sonnet 5 family (temperature removed)', () => {
    expect(modelAcceptsTemperature('claude-fable-5')).toBe(false);
    expect(modelAcceptsTemperature('claude-mythos-5')).toBe(false);
    expect(modelAcceptsTemperature('claude-opus-4-7')).toBe(false);
    expect(modelAcceptsTemperature('claude-opus-4-8')).toBe(false);
    expect(modelAcceptsTemperature('claude-sonnet-5')).toBe(false);
  });
});
