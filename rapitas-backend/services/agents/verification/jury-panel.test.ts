/**
 * jury-panel.test
 *
 * Who actually sits on the adversarial jury.
 *
 * The gate was built as a cross-provider panel because a single LLM judge is
 * near-chance on objective correctness (JudgeBench) and a small heterogeneous
 * jury beats one frontier judge (PoLL). Measured 2026-10-21 over the 876
 * recorded `adversarial_review` events, that panel no longer exists: 209 of
 * 209 October reviews were decided by one juror, the other two answering
 * "unavailable in Claude-only auxiliary CLI mode". Over the window where a
 * second opinion still existed, 51.4% of that juror's FAIL verdicts were
 * contested by another model, and in 36 of the 53 split reviews the fail was
 * the MINORITY — verdicts a majority would have passed.
 *
 * So the panel has to be rebuilt out of what the CLI can actually reach:
 * distinct Claude models. These tests pin the two properties that make that a
 * jury rather than a formality — three distinct voters so a majority exists,
 * and no duplicate voter smuggled in by two ids that resolve to one model.
 */
import { describe, expect, test } from 'bun:test';
import { buildPanel, juryModelIds, JURY_MODEL_IDS } from './jury-panel';

describe('when every provider is reachable', () => {
  test('keeps the cross-provider panel', () => {
    // Nothing about the CLI-mode repair should change the behaviour of a host
    // that can really call three vendors.
    const panel = buildPanel({ auxMode: 'api', implementerModel: null });
    expect(panel.map((j) => j.provider)).toEqual(['claude', 'gemini', 'chatgpt']);
  });

  test('puts the implementer last so a different family judges first', () => {
    const panel = buildPanel({ auxMode: 'api', implementerModel: 'claude-sonnet-4-20250514' });
    expect(panel[panel.length - 1].provider).toBe('claude');
    expect(panel).toHaveLength(3);
  });
});

describe('when only the Claude CLI is reachable', () => {
  test('seats three distinct models instead of one juror', () => {
    const panel = buildPanel({ auxMode: 'cli', implementerModel: null });
    expect(panel).toHaveLength(3);
    expect(panel.every((j) => j.provider === 'claude')).toBe(true);
    expect(new Set(panel.map((j) => j.model)).size).toBe(3);
  });

  test('gives every juror its own label, so health and votes are not merged', () => {
    const panel = buildPanel({ auxMode: 'cli', implementerModel: null });
    expect(new Set(panel.map((j) => j.label)).size).toBe(3);
    expect(panel[0].label).toContain('claude:');
  });

  test('asks a model other than the implementer first', () => {
    // Self-review is the weakest vote on the panel; it should not be the one
    // that answers while the others are still rested or timing out.
    const panel = buildPanel({ auxMode: 'cli', implementerModel: JURY_MODEL_IDS.sonnet });
    expect(panel[0].model).not.toBe(JURY_MODEL_IDS.sonnet);
    expect(panel[panel.length - 1].model).toBe(JURY_MODEL_IDS.sonnet);
  });

  test('still seats the implementer, because two voters cannot outvote', () => {
    // Dropping it would leave a panel of two, where one harsh juror ties the
    // vote and a tie breaks to fail — strictly harsher than today's single
    // juror, which is the opposite of what the measurement calls for.
    const panel = buildPanel({ auxMode: 'cli', implementerModel: JURY_MODEL_IDS.opus });
    expect(panel.map((j) => j.model)).toContain(JURY_MODEL_IDS.opus);
    expect(panel).toHaveLength(3);
  });
});

describe('choosing the juror models', () => {
  test('defaults to the three tiers', () => {
    expect(juryModelIds(undefined)).toEqual([
      JURY_MODEL_IDS.opus,
      JURY_MODEL_IDS.sonnet,
      JURY_MODEL_IDS.haiku,
    ]);
  });

  test('honours an explicit list', () => {
    expect(juryModelIds('sonnet,haiku')).toEqual([JURY_MODEL_IDS.sonnet, JURY_MODEL_IDS.haiku]);
  });

  test('refuses to count one model twice', () => {
    // The CLI maps any unrecognised model id to Haiku, so a list like
    // "haiku,claude-3-5-haiku" would otherwise look like two independent
    // votes and let one juror decide a majority on its own.
    expect(juryModelIds('haiku,claude-3-5-haiku-20241022,nonsense')).toEqual([
      JURY_MODEL_IDS.haiku,
    ]);
  });

  test('falls back to the default when the list names nothing usable', () => {
    expect(juryModelIds('   ')).toHaveLength(3);
    expect(juryModelIds(',,')).toHaveLength(3);
  });
});
