/**
 * phase-providers.test
 *
 * Which providers a workflow phase may run on is decided from what this host
 * can actually execute (CLI answers, logged in, not in cooldown), and the
 * agent configs that run them are kept in step with that — never from a
 * user's manual pick.
 */
import { describe, expect, test } from 'bun:test';
import { planPhaseAgentSync, phaseProvidersFrom, type PhaseAgentRow } from './phase-providers';

describe('phaseProvidersFrom', () => {
  test('both CLIs usable: Claude first (route order), then OpenAI', () => {
    const result = phaseProvidersFrom({
      usable: ['anthropic', 'openai'],
      unavailable: [{ vendor: 'google', reason: 'no CLI route' }],
    });
    expect(result.usable).toEqual(['claude', 'openai']);
    expect(result.excluded).toEqual(['gemini', 'ollama']);
  });

  test('Codex not logged in: only Claude, OpenAI excluded with its reason', () => {
    const result = phaseProvidersFrom({
      usable: ['anthropic'],
      unavailable: [{ vendor: 'openai', reason: 'Codex CLI に ChatGPT でログインしていない' }],
    });
    expect(result.usable).toEqual(['claude']);
    expect(result.excluded).toContain('openai');
    expect(result.reasons.openai).toContain('ログイン');
  });

  test('Google is never a phase provider: it has no CLI agent', () => {
    const result = phaseProvidersFrom({ usable: ['anthropic', 'google'], unavailable: [] });
    expect(result.usable).toEqual(['claude']);
    expect(result.excluded).toContain('gemini');
  });
});

describe('planPhaseAgentSync', () => {
  const claude: PhaseAgentRow = {
    id: 1,
    agentType: 'claude-code',
    isActive: true,
    isInstalled: true,
    isDefault: true,
    modelId: 'claude-opus-4-8',
  };

  test('creates the Codex agent when Codex becomes usable, without a pinned model', () => {
    const plan = planPhaseAgentSync([claude], ['claude', 'openai']);
    expect(plan.create).toEqual([{ agentType: 'codex', name: 'Codex' }]);
  });

  test('clears a hand-pinned model so the router decides (stale ids went unnoticed)', () => {
    const plan = planPhaseAgentSync([claude], ['claude']);
    expect(plan.update).toContainEqual({ id: 1, data: { modelId: null } });
  });

  test('reactivates an existing row for a usable provider instead of duplicating it', () => {
    const codex: PhaseAgentRow = {
      id: 2,
      agentType: 'codex',
      isActive: false,
      isInstalled: false,
      isDefault: false,
      modelId: null,
    };
    const plan = planPhaseAgentSync([{ ...claude, modelId: null }, codex], ['claude', 'openai']);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([{ id: 2, data: { isActive: true, isInstalled: true } }]);
  });

  test('deactivates an agent whose provider is no longer usable', () => {
    const codex: PhaseAgentRow = {
      id: 2,
      agentType: 'codex',
      isActive: true,
      isInstalled: true,
      isDefault: false,
      modelId: null,
    };
    const plan = planPhaseAgentSync([{ ...claude, modelId: null }, codex], ['claude']);
    expect(plan.update).toEqual([{ id: 2, data: { isActive: false } }]);
  });

  test('a cooldown is not a reason to deactivate: the row stays for when it lifts', () => {
    const codex: PhaseAgentRow = {
      id: 2,
      agentType: 'codex',
      isActive: true,
      isInstalled: true,
      isDefault: false,
      modelId: null,
    };
    const plan = planPhaseAgentSync([{ ...claude, modelId: null }, codex], ['claude'], {
      cooledProviders: ['openai'],
    });
    expect(plan.update).toEqual([]);
  });

  test('nothing to do when the rows already match', () => {
    const plan = planPhaseAgentSync([{ ...claude, modelId: null }], ['claude']);
    expect(plan).toEqual({ create: [], update: [] });
  });
});

// 2026-11-20: the first deploy created three Codex agents — concurrent routing
// calls each missed the cache, each saw no Codex row, each created one.
describe('duplicate agent rows', () => {
  const codexRow = (id: number): PhaseAgentRow => ({
    id,
    agentType: 'codex',
    isActive: true,
    isInstalled: true,
    isDefault: false,
    modelId: null,
  });
  const claudeRow: PhaseAgentRow = {
    id: 1,
    agentType: 'claude-code',
    isActive: true,
    isInstalled: true,
    isDefault: true,
    modelId: null,
  };

  test('keeps the oldest row per agent type and deactivates the copies', () => {
    const plan = planPhaseAgentSync(
      [claudeRow, codexRow(4), codexRow(2), codexRow(3)],
      ['claude', 'openai'],
    );
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([
      { id: 3, data: { isActive: false } },
      { id: 4, data: { isActive: false } },
    ]);
  });

  test('concurrent resolves run one probe and one sync', async () => {
    const { resolvePhaseProviders, resetPhaseProvidersCache } = await import('./phase-providers');
    resetPhaseProvidersCache();
    let probes = 0;
    let syncs = 0;
    const deps = {
      availability: async () => {
        probes += 1;
        await new Promise((r) => setTimeout(r, 20));
        return { usable: ['anthropic', 'openai'] as const, unavailable: [] } as never;
      },
      sync: async () => {
        syncs += 1;
      },
    };
    const results = await Promise.all([
      resolvePhaseProviders(deps),
      resolvePhaseProviders(deps),
      resolvePhaseProviders(deps),
    ]);
    expect(results.every((r) => r.usable.join() === 'claude,openai')).toBe(true);
    expect(probes).toBe(1);
    expect(syncs).toBe(1);
    resetPhaseProvidersCache();
  });
});
