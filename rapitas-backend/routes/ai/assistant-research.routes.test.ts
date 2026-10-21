/**
 * assistant-research.routes.test
 *
 * The one endpoint that reaches the network.
 *
 * What matters here is the shape of the door: it refuses a request with
 * nothing to compare on, it records the attempt either way, and it says
 * "nothing came back" in words rather than by returning an empty list that
 * reads as "there is nothing out there".
 *
 * The service is stubbed via mock.module (process-global — run this file in
 * isolation), with every export mirrored: Bun replaces the whole module, so
 * a missing one makes the file stop with a single error and its tests
 * vanish rather than fail.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

let asked: { goal: string; axes: string[]; decisions?: unknown }[] = [];
let answer: unknown = null;
let recorded: { capabilityId: string; status: string }[] = [];

const FINDINGS = {
  query: '自社開発 Web系',
  candidates: [
    {
      name: 'A社',
      sourceUrl: 'https://example.com/a',
      values: { 年収: '600万〜' },
      why: '自社開発',
    },
  ],
  unresolvedAxes: ['働き方'],
};

// Each module replaced on its own rather than the assistant barrel:
// replacing the barrel takes every other export with it, and the first
// thing that notices is an unrelated route failing to import (measured —
// `buildTaskDraft` not found).
mock.module('../../services/assistant/research', () => ({
  researchCandidates: async (input: { goal: string; axes: string[]; decisions?: unknown }) => {
    asked.push(input);
    return answer;
  },
  MAX_CANDIDATES: 8,
  RESEARCH_TIMEOUT_MS: 300_000,
}));

mock.module('../../services/assistant/action-log', () => ({
  recordAction: async (entry: { capabilityId: string; status: string }) => {
    recorded.push(entry);
  },
  listRecentActions: async () => [],
}));

const { assistantResearchRoutes } = await import('./assistant-research.routes');

const call = async (body: unknown) => {
  const res = await assistantResearchRoutes.handle(
    new Request('http://localhost/assistant/research', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const GOAL = { goal: '自社開発のWeb系に転職する', axes: ['年収', '働き方'] };

beforeEach(() => {
  asked = [];
  recorded = [];
  answer = FINDINGS;
});

describe('asking it to look something up', () => {
  it('passes the goal and the axes through', async () => {
    const { status, body } = await call(GOAL);
    expect(status).toBe(200);
    expect(asked[0]?.axes).toEqual(['年収', '働き方']);
    expect((body.findings as typeof FINDINGS).candidates).toHaveLength(1);
  });

  it('carries the decisions when there are any', async () => {
    await call({ ...GOAL, decisions: [{ question: '譲れない条件は', answer: '年収維持' }] });
    expect(asked[0]?.decisions).toEqual([{ question: '譲れない条件は', answer: '年収維持' }]);
  });

  it('refuses a request with nothing to compare on', async () => {
    // Without axes there is no table to fill, and the service would only
    // be asked to free-associate about the goal.
    const { status } = await call({ goal: '転職する', axes: [] });
    expect(status).toBe(422);
    expect(asked).toEqual([]);
  });

  it('refuses more axes than a plan can carry', async () => {
    const { status } = await call({ goal: '転職する', axes: Array(7).fill('軸') });
    expect(status).toBe(422);
  });
});

describe('when nothing comes back', () => {
  it('says so rather than returning an empty list', async () => {
    // An empty list reads as "there is nothing out there", which is a
    // different statement from "the search did not work".
    answer = null;
    const { status, body } = await call(GOAL);
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.findings).toBeUndefined();
  });
});

describe('the record', () => {
  it('logs the attempt as the capability it is', async () => {
    await call(GOAL);
    expect(recorded[0]).toMatchObject({ capabilityId: 'research.candidates', status: 'executed' });
  });

  it('logs a failed search too, so a quiet one is still visible', async () => {
    answer = null;
    await call(GOAL);
    expect(recorded[0]).toMatchObject({ capabilityId: 'research.candidates', status: 'failed' });
  });
});
