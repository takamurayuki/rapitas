import { describe, it, expect } from 'vitest';
import { selectPhaseType } from '../phase-selector';

describe('selectPhaseType', () => {
  it('maps known workflow session modes to their phase', () => {
    expect(selectPhaseType('workflow-researcher')).toBe('research');
    expect(selectPhaseType('workflow-planner')).toBe('plan');
    expect(selectPhaseType('workflow-implementer')).toBe('implement');
    expect(selectPhaseType('workflow-verifier')).toBe('verify');
    expect(selectPhaseType('workflow-auto_verifier')).toBe('verify');
  });

  it('returns null for unrecognized or missing modes', () => {
    expect(selectPhaseType(null)).toBeNull();
    expect(selectPhaseType(undefined)).toBeNull();
    expect(selectPhaseType('development')).toBeNull();
    expect(selectPhaseType('')).toBeNull();
  });
});
