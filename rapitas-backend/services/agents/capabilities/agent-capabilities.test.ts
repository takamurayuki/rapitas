/**
 * Tests for agent-capabilities scoring and lookup.
 */

import { describe, expect, test } from 'bun:test';
import { AGENT_CAPABILITIES, getCapability, scoreAgentForRole } from './agent-capabilities';

describe('AGENT_CAPABILITIES registry', () => {
  test('codex is suitable for impl, and for research/plan/review only via investigationMode', () => {
    const codex = AGENT_CAPABILITIES.codex;
    expect(codex.bestForRoles).toContain('implementer');
    // Codex can do research/plan/review safely WHEN wrapped in
    // investigationMode (--sandbox=read-only --ask-for-approval=never -o).
    // workflow-cli-executor toggles this automatically for non-impl phases.
    expect(codex.bestForRoles).toContain('researcher');
    expect(codex.bestForRoles).toContain('planner');
    expect(codex.bestForRoles).toContain('reviewer');
    expect(codex.followsStrictInstructions).toBe(false);
    expect(codex.notes).toContain('investigationMode');
  });

  test('claude-code is suitable for all roles', () => {
    const claude = AGENT_CAPABILITIES['claude-code'];
    expect(claude.bestForRoles).toContain('researcher');
    expect(claude.bestForRoles).toContain('planner');
    expect(claude.bestForRoles).toContain('implementer');
    expect(claude.followsStrictInstructions).toBe(true);
    expect(claude.reliableMarkdownOutput).toBe(true);
  });

  test('api agents are excluded from impl/verify (no file/exec)', () => {
    expect(AGENT_CAPABILITIES['anthropic-api'].avoidForRoles).toContain('implementer');
    expect(AGENT_CAPABILITIES['openai-api'].avoidForRoles).toContain('implementer');
  });
});

describe('getCapability', () => {
  test('returns known capability for registered types', () => {
    expect(getCapability('codex').type).toBe('codex');
    expect(getCapability('claude-code').type).toBe('claude-code');
  });

  test('returns conservative fallback for unknown types', () => {
    const cap = getCapability('mystery-agent');
    expect(cap.bestForRoles).toEqual([]);
    expect(cap.avoidForRoles.length).toBeGreaterThan(0);
  });
});

describe('scoreAgentForRole', () => {
  test('codex scores highest for implementer', () => {
    expect(scoreAgentForRole('codex', 'implementer')).toBeGreaterThan(70);
  });

  test('codex scores positive but lower than claude-code for research/plan/review', () => {
    const codexResearch = scoreAgentForRole('codex', 'researcher');
    const claudeResearch = scoreAgentForRole('claude-code', 'researcher');
    expect(codexResearch).toBeGreaterThan(0); // usable via investigationMode
    expect(codexResearch).toBeLessThan(claudeResearch); // but not preferred
    const codexPlanner = scoreAgentForRole('codex', 'planner');
    const claudePlanner = scoreAgentForRole('claude-code', 'planner');
    expect(codexPlanner).toBeLessThan(claudePlanner);
  });

  test('claude-code scores well across all roles', () => {
    expect(scoreAgentForRole('claude-code', 'researcher')).toBeGreaterThan(70);
    expect(scoreAgentForRole('claude-code', 'planner')).toBeGreaterThan(70);
    expect(scoreAgentForRole('claude-code', 'reviewer')).toBeGreaterThan(70);
    expect(scoreAgentForRole('claude-code', 'implementer')).toBeGreaterThan(70);
  });

  test('api agents score well for plan/research, badly for implementer', () => {
    expect(scoreAgentForRole('anthropic-api', 'planner')).toBeGreaterThan(70);
    expect(scoreAgentForRole('anthropic-api', 'researcher')).toBeGreaterThan(70);
    expect(scoreAgentForRole('anthropic-api', 'implementer')).toBe(-100);
  });

  test('ollama scores badly for serious roles', () => {
    expect(scoreAgentForRole('ollama', 'planner')).toBe(-100);
    expect(scoreAgentForRole('ollama', 'reviewer')).toBe(-100);
  });

  test('unknown types score 0 or below', () => {
    expect(scoreAgentForRole('unknown', 'implementer')).toBeLessThanOrEqual(0);
  });
});
