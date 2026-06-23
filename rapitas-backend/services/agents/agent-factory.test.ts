/**
 * agent-factory.test
 *
 * Unit tests for AGENT_TYPES, isAgentType, and narrowAgentType.
 * These functions guard DB-sourced agent type strings against unknown values.
 */
import { describe, it, expect, mock } from 'bun:test';

// Mock heavy agent dependencies before importing agent-factory.
mock.module('./base-agent', () => ({
  BaseAgent: class {},
  AgentCapability: {},
}));
mock.module('./claude-code-agent', () => ({
  ClaudeCodeAgent: class {},
}));
mock.module('./gemini-cli-agent', () => ({
  GeminiCliAgent: class {},
}));
mock.module('./codex-cli-agent', () => ({
  CodexCliAgent: class {},
}));

const { AGENT_TYPES, isAgentType, narrowAgentType } = await import('./agent-factory');

describe('AGENT_TYPES', () => {
  it('contains exactly the four known agent type strings', () => {
    expect(AGENT_TYPES).toEqual(['claude-code', 'codex', 'gemini', 'custom']);
  });
});

describe('isAgentType', () => {
  it.each(['claude-code', 'codex', 'gemini', 'custom'] as const)(
    'returns true for valid agent type "%s"',
    (type) => {
      expect(isAgentType(type)).toBe(true);
    },
  );

  it('returns false for an invalid string', () => {
    expect(isAgentType('openai')).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAgentType(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isAgentType(undefined)).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isAgentType('')).toBe(false);
  });
});

describe('narrowAgentType', () => {
  it('returns the value when it is a valid agent type', () => {
    expect(narrowAgentType('gemini')).toBe('gemini');
  });

  it('returns the default fallback "claude-code" for an invalid string', () => {
    expect(narrowAgentType('unknown-agent')).toBe('claude-code');
  });

  it('returns the default fallback for null', () => {
    expect(narrowAgentType(null)).toBe('claude-code');
  });

  it('returns the default fallback for undefined', () => {
    expect(narrowAgentType(undefined)).toBe('claude-code');
  });

  it('uses a custom fallback when provided', () => {
    expect(narrowAgentType('bad-value', 'codex')).toBe('codex');
  });
});
