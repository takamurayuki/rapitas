/**
 * workflow-mode-config.test
 *
 * Pure-logic tests for mode-tier ordering, upgrade-only selection, the
 * conservative provisional-mode bias, and the transition-table generator that
 * replaced the previously-hardcoded per-mode status tables (the actual
 * state-machine wiring the orchestrator drives from).
 */
import { describe, it, expect } from 'bun:test';
import {
  MODE_TIER,
  higherMode,
  applyProvisionalBias,
  buildTransitions,
  buildRoleByStatus,
  recommendModeFromSettings,
  DEFAULT_MODE_SETTINGS,
  type WorkflowModeSettings,
} from './workflow-mode-config';
import type { WorkflowMode } from './workflow-types';

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

describe('buildTransitions', () => {
  it('lightweight (no plan): research_done goes straight to implementer', () => {
    const t = buildTransitions(DEFAULT_MODE_SETTINGS.lightweight);
    expect(t.draft).toEqual({
      role: 'researcher',
      outputFile: 'research',
      nextStatus: 'research_done',
    });
    expect(t.research_done).toEqual({
      role: 'implementer',
      outputFile: null,
      nextStatus: 'in_progress',
    });
    // No plan phase — plan_created/plan_approved-as-entry are not generated.
    expect(t.plan_created).toBeUndefined();
    expect(t.plan_approved).toBeUndefined();
  });

  it('standard (plan): research_done goes to planner; plan_approved to implementer', () => {
    const t = buildTransitions(DEFAULT_MODE_SETTINGS.standard);
    expect(t.research_done).toEqual({
      role: 'planner',
      outputFile: 'plan',
      nextStatus: 'plan_created',
    });
    expect(t.plan_approved).toEqual({
      role: 'implementer',
      outputFile: null,
      nextStatus: 'in_progress',
    });
    // plan_created is the approval gate, never an agent phase.
    expect(t.plan_created).toBeUndefined();
  });

  it('comprehensive: plan_created is the approval gate — no agent phase entry (reviewer retired)', () => {
    const t = buildTransitions(DEFAULT_MODE_SETTINGS.comprehensive);
    expect(t.plan_created).toBeUndefined();
    expect(t.plan_approved).toEqual({
      role: 'implementer',
      outputFile: null,
      nextStatus: 'in_progress',
    });
  });

  it('every mode ends in_progress at the verifier/auto_verifier phase per autoVerify', () => {
    const lightweight = buildTransitions(DEFAULT_MODE_SETTINGS.lightweight);
    const standard = buildTransitions(DEFAULT_MODE_SETTINGS.standard);
    expect(lightweight.in_progress).toEqual({
      role: 'auto_verifier',
      outputFile: 'verify',
      nextStatus: 'verify_done',
    });
    expect(standard.in_progress).toEqual({
      role: 'verifier',
      outputFile: 'verify',
      nextStatus: 'verify_done',
    });
  });

  it('draft->research_done is identical across all three modes (shared entry point)', () => {
    const modes: WorkflowMode[] = ['lightweight', 'standard', 'comprehensive'];
    for (const m of modes) {
      expect(buildTransitions(DEFAULT_MODE_SETTINGS[m]).draft).toEqual({
        role: 'researcher',
        outputFile: 'research',
        nextStatus: 'research_done',
      });
    }
  });
});

describe('buildRoleByStatus', () => {
  it('projects buildTransitions down to a status->role map', () => {
    const roleMap = buildRoleByStatus(DEFAULT_MODE_SETTINGS.comprehensive);
    expect(roleMap.draft).toBe('researcher');
    expect(roleMap.research_done).toBe('planner');
    expect(roleMap.plan_created).toBeUndefined();
    expect(roleMap.plan_approved).toBe('implementer');
    expect(roleMap.in_progress).toBe('verifier');
  });

  it('lightweight role map has no planner entry', () => {
    const roleMap = buildRoleByStatus(DEFAULT_MODE_SETTINGS.lightweight);
    expect(Object.values(roleMap)).not.toContain('planner');
  });
});

describe('recommendModeFromSettings', () => {
  it('picks the enabled mode whose complexity range contains the score', () => {
    expect(recommendModeFromSettings(10, DEFAULT_MODE_SETTINGS)).toBe('lightweight');
    expect(recommendModeFromSettings(50, DEFAULT_MODE_SETTINGS)).toBe('standard');
    expect(recommendModeFromSettings(90, DEFAULT_MODE_SETTINGS)).toBe('comprehensive');
  });

  it('respects range boundaries exactly (inclusive)', () => {
    expect(recommendModeFromSettings(35, DEFAULT_MODE_SETTINGS)).toBe('lightweight');
    expect(recommendModeFromSettings(36, DEFAULT_MODE_SETTINGS)).toBe('standard');
    expect(recommendModeFromSettings(70, DEFAULT_MODE_SETTINGS)).toBe('standard');
    expect(recommendModeFromSettings(71, DEFAULT_MODE_SETTINGS)).toBe('comprehensive');
  });

  it('skips a disabled mode even if the score falls in its range', () => {
    const all: Record<WorkflowMode, WorkflowModeSettings> = {
      ...DEFAULT_MODE_SETTINGS,
      lightweight: { ...DEFAULT_MODE_SETTINGS.lightweight, isEnabled: false },
    };
    // Score 10 would match lightweight's range, but it's disabled — falls back
    // to the legacy 35/70 split, which still resolves 10 -> lightweight label,
    // so use a score that would only match lightweight to prove the disabled
    // mode is skipped: since no OTHER enabled mode's range covers 10, the
    // legacy fallback (score <= 35 -> lightweight) still applies. Use a custom
    // config where standard's range covers 10 instead, to prove skip-when-disabled.
    const custom: Record<WorkflowMode, WorkflowModeSettings> = {
      ...all,
      standard: { ...DEFAULT_MODE_SETTINGS.standard, complexityMin: 0, complexityMax: 100 },
    };
    expect(recommendModeFromSettings(10, custom)).toBe('standard');
  });

  it('falls back to the legacy 35/70 split when no enabled mode matches', () => {
    const all: Record<WorkflowMode, WorkflowModeSettings> = {
      lightweight: { ...DEFAULT_MODE_SETTINGS.lightweight, isEnabled: false },
      standard: { ...DEFAULT_MODE_SETTINGS.standard, isEnabled: false },
      comprehensive: { ...DEFAULT_MODE_SETTINGS.comprehensive, isEnabled: false },
    };
    expect(recommendModeFromSettings(20, all)).toBe('lightweight');
    expect(recommendModeFromSettings(50, all)).toBe('standard');
    expect(recommendModeFromSettings(80, all)).toBe('comprehensive');
  });
});

describe('pickModeForScore — 有効帯を超えるスコアのクランプ', () => {
  const bands = (compEnabled: boolean) => ({
    lightweight: { isEnabled: true, complexityMin: 0, complexityMax: 36 },
    standard: { isEnabled: true, complexityMin: 37, complexityMax: 74 },
    comprehensive: { isEnabled: compEnabled, complexityMin: 75, complexityMax: 100 },
  });
  it('comprehensive 無効時、スコア76は最上位の有効モード standard に落ちる（#784）', async () => {
    const { pickModeForScore } = await import('./workflow-mode-config');
    expect(pickModeForScore(76, bands(false) as never)).toBe('standard');
  });
  it('comprehensive 有効時は帯どおり comprehensive', async () => {
    const { pickModeForScore } = await import('./workflow-mode-config');
    expect(pickModeForScore(76, bands(true) as never)).toBe('comprehensive');
    expect(pickModeForScore(20, bands(true) as never)).toBe('lightweight');
    expect(pickModeForScore(50, bands(true) as never)).toBe('standard');
  });
});
