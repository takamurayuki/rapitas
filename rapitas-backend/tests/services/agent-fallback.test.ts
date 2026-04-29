/**
 * Agent Fallback テスト
 *
 * Validates agentTypeToProvider mapping. Database-driven fallback selection
 * is verified by integration paths; here we just lock down the type mapping
 * so the cooldown registry and DB lookup agree.
 */
import { describe, it, expect } from 'bun:test';
import { agentTypeToProvider } from '../../services/ai/agent-fallback';

describe('agentTypeToProvider', () => {
  it('claude family → claude', () => {
    expect(agentTypeToProvider('claude-code')).toBe('claude');
    expect(agentTypeToProvider('anthropic-api')).toBe('claude');
    expect(agentTypeToProvider('claude')).toBe('claude');
  });

  it('openai family → openai', () => {
    expect(agentTypeToProvider('codex')).toBe('openai');
    expect(agentTypeToProvider('codex-cli')).toBe('openai');
    expect(agentTypeToProvider('openai')).toBe('openai');
    expect(agentTypeToProvider('chatgpt')).toBe('openai');
  });

  it('gemini family → gemini', () => {
    expect(agentTypeToProvider('gemini-cli')).toBe('gemini');
    expect(agentTypeToProvider('gemini')).toBe('gemini');
    expect(agentTypeToProvider('google-gemini')).toBe('gemini');
  });

  it('ollama family → ollama', () => {
    expect(agentTypeToProvider('ollama')).toBe('ollama');
    expect(agentTypeToProvider('ollama-cli')).toBe('ollama');
  });

  it('未知のtype → null', () => {
    expect(agentTypeToProvider('mystery')).toBeNull();
    expect(agentTypeToProvider('')).toBeNull();
    expect(agentTypeToProvider(null)).toBeNull();
    expect(agentTypeToProvider(undefined)).toBeNull();
  });
});
