/**
 * jury-seats テスト
 *
 * Seats are defined by role and tier; only the host resolution turns a tier
 * into a model.
 */
import { describe, test, expect, afterEach } from 'bun:test';
import { DEFAULT_SEATS, assignSeats } from './jury-seats';

const saved = process.env.RAPITAS_JURY_MODELS;
afterEach(() => {
  if (saved === undefined) delete process.env.RAPITAS_JURY_MODELS;
  else process.env.RAPITAS_JURY_MODELS = saved;
});

describe('DEFAULT_SEATS', () => {
  test('レビュー席2つと検証席1つを、役割とティアだけで定義する', () => {
    expect(DEFAULT_SEATS).toEqual([
      { seatId: 'reviewer-1', role: 'reviewer', tier: 'premium' },
      { seatId: 'reviewer-2', role: 'reviewer', tier: 'standard' },
      { seatId: 'verifier', role: 'verifier', tier: 'premium' },
    ]);
    // No vendor or model in the definition itself.
    expect(JSON.stringify(DEFAULT_SEATS)).not.toMatch(/claude|opus|sonnet|gemini|gpt/i);
  });
});

describe('assignSeats', () => {
  test('CLI ホストではティアを CLI のモデルに解決する', () => {
    delete process.env.RAPITAS_JURY_MODELS;
    const s = assignSeats({ auxMode: 'cli' });
    expect(s.reviewers.map((r) => [r.seatId, r.tier, r.model])).toEqual([
      ['reviewer-1', 'premium', 'claude-opus-4-20250514'],
      ['reviewer-2', 'standard', 'claude-sonnet-4-20250514'],
    ]);
    expect(s.verifier.seatId).toBe('verifier');
    expect(s.verifier.role).toBe('verifier');
    expect(s.verifier.model).toBe('claude-opus-4-20250514');
    // Health tracking label stays per model, so a seat that keeps timing out rests.
    expect(s.reviewers[0].label).toBe('claude:opus');
  });

  test('RAPITAS_JURY_MODELS は席の順（レビュー1・レビュー2・検証）に割り当てる', () => {
    process.env.RAPITAS_JURY_MODELS = 'claude-sonnet-4-20250514,claude-sonnet-4-20250514';
    const s = assignSeats({ auxMode: 'cli' });
    expect(s.reviewers.map((r) => r.model)).toEqual([
      'claude-sonnet-4-20250514',
      'claude-sonnet-4-20250514',
    ]);
    // Unlisted seat keeps its tier default.
    expect(s.verifier.model).toBe('claude-opus-4-20250514');
  });

  test('API ホストでは到達できるプロバイダを席の順に割り当てる', () => {
    const s = assignSeats({ auxMode: 'api', providers: ['gemini', 'chatgpt'] });
    expect(s.reviewers.map((r) => r.provider)).toEqual(['gemini', 'chatgpt']);
    expect(s.verifier.provider).toBe('gemini');
  });
});
