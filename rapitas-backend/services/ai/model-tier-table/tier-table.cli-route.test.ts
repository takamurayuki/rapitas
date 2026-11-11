/**
 * tier-table.cli-route.test
 *
 * The Codex CLI route column (routing2b): which rows a subscription CLI
 * reaches, decided by the row's vendor — Claude Code aliases for Anthropic,
 * the Codex model id for OpenAI, nothing for Google.
 */
import { describe, expect, test } from 'bun:test';
import { cliRouteOf, findModelEntry, MODEL_TIER_TABLE, seatableEntries } from './tier-table';

describe('codexCliModel column', () => {
  test('confirmed OpenAI rows pass their own id to `codex exec -m`', () => {
    for (const id of ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']) {
      expect(findModelEntry(id)?.codexCliModel).toBe(id);
    }
  });

  test('deprecated, Anthropic and Google rows have no Codex route', () => {
    expect(findModelEntry('gpt-5.3-codex')?.codexCliModel).toBeNull();
    for (const e of MODEL_TIER_TABLE.filter((r) => r.vendor !== 'openai')) {
      expect(e.codexCliModel).toBeNull();
    }
  });
});

describe('cliRouteOf', () => {
  test('routes by vendor, never across', () => {
    expect(cliRouteOf(findModelEntry('claude-opus-5-5')!)).toBe('claude');
    expect(cliRouteOf(findModelEntry('gpt-6-astra')!)).toBe('codex');
    // Fable has no confirmed Claude Code alias; Gemini has no aux CLI route.
    expect(cliRouteOf(findModelEntry('claude-fable-5-2')!)).toBeNull();
    expect(cliRouteOf(findModelEntry('gemini-4-argon')!)).toBeNull();
  });
});

describe('seatableEntries({ cliOnly })', () => {
  test('a Codex-only CLI host can seat the current OpenAI rows', () => {
    const ids = seatableEntries({ vendors: ['openai'], cliOnly: true }).map((e) => e.modelId);
    expect(ids).toEqual(['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna']);
  });

  test('Google stays out of a CLI host', () => {
    expect(seatableEntries({ vendors: ['google'], cliOnly: true })).toEqual([]);
  });
});
