/**
 * Agent Models テスト
 * エージェントタイプ別モデル取得のテスト
 */
import { describe, test, expect } from 'bun:test';
import { getModelsForAgentType, getAllModels } from '../../utils/agent-models';

describe('getModelsForAgentType', () => {
  test('claude-codeのモデル一覧を取得できること（フォールバック）', async () => {
    const models = await getModelsForAgentType('claude-code');
    expect(models.length).toBeGreaterThan(0);
    expect(models[0]).toHaveProperty('value');
    expect(models[0]).toHaveProperty('label');
  });

  test('anthropic-apiのモデル一覧を取得できること（フォールバック）', async () => {
    const models = await getModelsForAgentType('anthropic-api');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.value.includes('claude'))).toBe(true);
  });

  test('openaiのモデル一覧を取得できること（フォールバック）', async () => {
    const models = await getModelsForAgentType('openai');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.value.includes('gpt'))).toBe(true);
  });

  test('codexのモデル一覧を取得できること（フォールバック）', async () => {
    const models = await getModelsForAgentType('codex');
    expect(models.length).toBeGreaterThan(0);
  });

  test('geminiのモデル一覧を取得できること（フォールバック）', async () => {
    const models = await getModelsForAgentType('gemini');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.value.includes('gemini'))).toBe(true);
  });

  test('azure-openaiのモデル一覧を取得できること', async () => {
    const models = await getModelsForAgentType('azure-openai');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.value.includes('gpt'))).toBe(true);
  });

  test('customタイプは空配列を返すこと', async () => {
    const models = await getModelsForAgentType('custom');
    expect(models).toEqual([]);
  });

  test('未知のタイプは空配列を返すこと', async () => {
    const models = await getModelsForAgentType('unknown');
    expect(models).toEqual([]);
  });

  test('全モデルにvalueとlabelがあること', async () => {
    const types = ['claude-code', 'anthropic-api', 'openai', 'codex', 'gemini', 'azure-openai'];
    for (const type of types) {
      const models = await getModelsForAgentType(type);
      for (const model of models) {
        expect(model.value).toBeTruthy();
        expect(model.label).toBeTruthy();
      }
    }
  });
});

describe('getAllModels', () => {
  test('全エージェントタイプのモデルを返すこと', async () => {
    const allModels = await getAllModels();
    expect(allModels['claude-code']).toBeDefined();
    expect(allModels['anthropic-api']).toBeDefined();
    expect(allModels['openai']).toBeDefined();
    expect(allModels['codex']).toBeDefined();
    expect(allModels['gemini']).toBeDefined();
    expect(allModels['azure-openai']).toBeDefined();
  });

  test('各タイプに配列が含まれること', async () => {
    const allModels = await getAllModels();
    for (const [, models] of Object.entries(allModels)) {
      expect(Array.isArray(models)).toBe(true);
    }
  });
});
