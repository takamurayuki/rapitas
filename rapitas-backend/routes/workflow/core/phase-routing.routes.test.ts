/**
 * phase-routing.routes.test
 *
 * The routing view tells the user what was decided automatically, so it must
 * say which providers are usable, why the rest are not, and whether the
 * verifier can actually use a different provider on this host.
 */
import { describe, expect, test } from 'bun:test';
import { buildPhaseRoutingView } from './phase-routing.routes';

describe('buildPhaseRoutingView', () => {
  test('both CLIs usable: verifiers really run on a different provider', () => {
    const view = buildPhaseRoutingView({
      usable: ['claude', 'openai'],
      excluded: ['gemini', 'ollama'],
      cooled: [],
      reasons: { gemini: 'CLI エージェントがない', ollama: 'CLI エージェントがない' },
    });
    expect(view.usable).toEqual(['claude', 'openai']);
    const verifier = view.roles.find((r) => r.role === 'verifier');
    expect(verifier).toEqual({
      role: 'verifier',
      rule: 'different_from_upstream',
      crossProviderActive: true,
    });
    expect(view.roles.find((r) => r.role === 'implementer')?.rule).toBe('follow_upstream');
  });

  test('Claude only: the verifier cannot switch, and Codex says why', () => {
    const view = buildPhaseRoutingView({
      usable: ['claude'],
      excluded: ['openai', 'gemini', 'ollama'],
      cooled: ['openai'],
      reasons: { openai: 'usage limit' },
    });
    expect(view.roles.find((r) => r.role === 'verifier')?.crossProviderActive).toBe(false);
    expect(view.unavailable[0]).toEqual({
      provider: 'openai',
      reason: 'usage limit',
      cooled: true,
    });
  });
});
