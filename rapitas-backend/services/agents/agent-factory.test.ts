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

  it.each([
    { name: 'an invalid string', value: 'openai' },
    { name: 'null', value: null },
    { name: 'undefined', value: undefined },
    { name: 'empty string', value: '' },
  ])('returns false for $name', ({ value }) => {
    expect(isAgentType(value)).toBe(false);
  });
});

describe('narrowAgentType', () => {
  it.each([
    {
      desc: 'returns the value when it is a valid agent type',
      input: 'gemini',
      expected: 'gemini',
    },
    {
      desc: 'returns the default fallback "claude-code" for an invalid string',
      input: 'unknown-agent',
      expected: 'claude-code',
    },
    { desc: 'returns the default fallback for null', input: null, expected: 'claude-code' },
    {
      desc: 'returns the default fallback for undefined',
      input: undefined,
      expected: 'claude-code',
    },
  ])('$desc', ({ input, expected }) => {
    expect(narrowAgentType(input)).toBe(expected);
  });

  it('uses a custom fallback when provided', () => {
    expect(narrowAgentType('bad-value', 'codex')).toBe('codex');
  });
});
