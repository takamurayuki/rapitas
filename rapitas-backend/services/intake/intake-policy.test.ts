/**
 * intake-policy.test
 *
 * Unit tests for policy resolution (task → env → default) and the pure
 * decision matrix.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { resolveIntakePolicy, decideIntake } from './intake-policy';

const ENV_KEY = 'RAPITAS_INTAKE_ASK_WHEN_AMBIGUOUS';
const original = process.env[ENV_KEY];

afterEach(() => {
  if (original === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = original;
});

describe('resolveIntakePolicy', () => {
  it('defaults to ask when nothing is configured', () => {
    delete process.env[ENV_KEY];
    expect(resolveIntakePolicy()).toEqual({ policy: 'ask', source: 'default' });
  });

  it('honors a per-task override above everything', () => {
    process.env[ENV_KEY] = 'best_guess';
    expect(resolveIntakePolicy({ taskPolicy: 'ask' })).toEqual({ policy: 'ask', source: 'task' });
  });

  it('reads truthy env values as ask', () => {
    for (const v of ['true', '1', 'yes', 'on']) {
      process.env[ENV_KEY] = v;
      expect(resolveIntakePolicy()).toEqual({ policy: 'ask', source: 'env' });
    }
  });

  it('reads falsy env values as best_guess', () => {
    for (const v of ['false', '0', 'no', 'off']) {
      process.env[ENV_KEY] = v;
      expect(resolveIntakePolicy()).toEqual({ policy: 'best_guess', source: 'env' });
    }
  });

  it('falls back to default for an unrecognized env value', () => {
    process.env[ENV_KEY] = 'maybe';
    expect(resolveIntakePolicy()).toEqual({ policy: 'ask', source: 'default' });
  });
});

describe('decideIntake', () => {
  it('returns ready whenever the spec is adequate (regardless of policy)', () => {
    expect(decideIntake(true, false, 'ask')).toBe('ready');
    expect(decideIntake(true, true, 'best_guess')).toBe('ready');
  });

  it('keeps asking when thin, policy=ask, and NOT yet answered (waits for the user)', () => {
    expect(decideIntake(false, false, 'ask')).toBe('ask');
  });

  it('proceeds (best-guess) only AFTER the user answered but the spec is still thin', () => {
    expect(decideIntake(false, true, 'ask')).toBe('proceed_low_confidence');
  });

  it('proceeds on best_guess policy without asking', () => {
    expect(decideIntake(false, false, 'best_guess')).toBe('proceed_low_confidence');
  });
});
