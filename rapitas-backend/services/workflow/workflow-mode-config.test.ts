/**
 * workflow-mode-config.test
 *
 * Pure-logic tests for mode-tier ordering, upgrade-only selection, and the
 * conservative provisional-mode bias.
 */
import { describe, it, expect } from 'bun:test';
import { MODE_TIER, higherMode, applyProvisionalBias } from './workflow-mode-config';

describe('MODE_TIER / higherMode', () => {
  it('orders modes by ceremony', () => {
    expect(MODE_TIER.lightweight).toBeLessThan(MODE_TIER.standard);
    expect(MODE_TIER.standard).toBeLessThan(MODE_TIER.comprehensive);
  });

  it('returns the higher-ceremony mode (upgrade-only helper)', () => {
    expect(higherMode('lightweight', 'standard')).toBe('standard');
    expect(higherMode('standard', 'comprehensive')).toBe('comprehensive');
    expect(higherMode('comprehensive', 'lightweight')).toBe('comprehensive');
    expect(higherMode('lightweight', 'lightweight')).toBe('lightweight');
  });
});

describe('applyProvisionalBias', () => {
  it('trusts lightweight when the score is clearly low', () => {
    expect(applyProvisionalBias('lightweight', 10, true, 17)).toBe('lightweight');
    expect(applyProvisionalBias('lightweight', 17, true, 17)).toBe('lightweight');
  });

  it('bumps an ambiguous lightweight up to standard', () => {
    expect(applyProvisionalBias('lightweight', 30, true, 17)).toBe('standard');
  });

  it('keeps lightweight when standard is disabled (nothing to bump to)', () => {
    expect(applyProvisionalBias('lightweight', 30, false, 17)).toBe('lightweight');
  });

  it('never alters standard or comprehensive', () => {
    expect(applyProvisionalBias('standard', 5, true, 17)).toBe('standard');
    expect(applyProvisionalBias('comprehensive', 5, true, 17)).toBe('comprehensive');
  });
});
