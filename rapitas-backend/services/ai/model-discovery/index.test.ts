/**
 * model-discovery/index テスト
 *
 * premium 帯の cheapest() 選定が opus を優先すること（#797: fable/mythos が
 * inferCostPer1k の旧ヒューリスティックで opus より安く見え、誤って選ばれて
 * いたバグの回帰確認）。probeClaude 以外のプローブは空応答にモックし、
 * probeClaude のみ fable/opus 両方を返す。
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

const fableModel = {
  id: 'claude-fable-5',
  provider: 'claude' as const,
  tier: 'premium' as const,
  costPer1kTokens: 0.04,
  source: 'cli-alias' as const,
};
const opusModel = {
  id: 'claude-opus-4-8',
  provider: 'claude' as const,
  tier: 'premium' as const,
  costPer1kTokens: 0.025,
  source: 'cli-alias' as const,
};

mock.module('./probes/claude-probe', () => ({
  probeClaude: mock(async () => ({
    provider: 'claude' as const,
    available: true,
    models: [fableModel, opusModel],
  })),
}));
mock.module('./probes/openai-probe', () => ({
  probeOpenAi: mock(async () => ({ provider: 'openai' as const, available: false, models: [] })),
}));
mock.module('./probes/gemini-probe', () => ({
  probeGemini: mock(async () => ({ provider: 'gemini' as const, available: false, models: [] })),
}));
mock.module('./probes/ollama-probe', () => ({
  probeOllama: mock(async () => ({ provider: 'ollama' as const, available: false, models: [] })),
}));

const { selectBestModel, invalidateModelDiscoveryCache } = await import('./index');

describe('selectBestModel — premium帯コスト推定修正(#797)', () => {
  test('fable/opus両方が候補のとき、実際に単価が安いopusを選ぶ', async () => {
    invalidateModelDiscoveryCache();
    const result = await selectBestModel({ desiredTier: 'premium' });
    expect(result?.model.id).toBe('claude-opus-4-8');
    expect(result?.tier).toBe('premium');
  });
});
