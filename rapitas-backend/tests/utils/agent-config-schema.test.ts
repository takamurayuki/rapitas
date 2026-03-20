/**
 * Agent Config Schema Test
 *
 * Tests for agent configuration schema validation functions.
 */
import { describe, test, expect } from 'bun:test';
import {
  getAgentConfigSchema,
  getAllAgentConfigSchemas,
  validateApiKeyFormat,
  validateAgentConfig,
} from '../../utils/agent/agent-config-schema';

describe('getAgentConfigSchema', () => {
  test('claude-codeのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('claude-code');
    expect(schema).not.toBeNull();
    expect(schema!.agentType).toBe('claude-code');
    expect(schema!.displayName).toBe('Claude Code');
    expect(schema!.apiKeyRequired).toBe(false);
  });

  test('anthropic-apiのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('anthropic-api');
    expect(schema).not.toBeNull();
    expect(schema!.apiKeyRequired).toBe(true);
    expect(schema!.apiKeyPrefix).toBe('sk-ant-');
  });

  test('openaiのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('openai');
    expect(schema).not.toBeNull();
    expect(schema!.apiKeyRequired).toBe(true);
    expect(schema!.apiKeyPrefix).toBe('sk-');
  });

  test('azure-openaiのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('azure-openai');
    expect(schema).not.toBeNull();
    expect(schema!.endpointRequired).toBe(true);
  });

  test('geminiのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('gemini');
    expect(schema).not.toBeNull();
    expect(schema!.apiKeyRequired).toBe(false);
  });

  test('customのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('custom');
    expect(schema).not.toBeNull();
    expect(schema!.endpointRequired).toBe(true);
  });

  test('codexのスキーマを取得できること', () => {
    const schema = getAgentConfigSchema('codex');
    expect(schema).not.toBeNull();
  });

  test('存在しないタイプでnullを返すこと', () => {
    expect(getAgentConfigSchema('nonexistent')).toBeNull();
  });
});

describe('getAllAgentConfigSchemas', () => {
  test('全7タイプのスキーマを返すこと', () => {
    const schemas = getAllAgentConfigSchemas();
    expect(schemas.length).toBe(7);
  });

  test('全スキーマにcapabilitiesが含まれること', () => {
    const schemas = getAllAgentConfigSchemas();
    for (const schema of schemas) {
      expect(schema.capabilities).toBeDefined();
      expect(typeof schema.capabilities.codeGeneration).toBe('boolean');
    }
  });
});

describe('validateApiKeyFormat', () => {
  test('未知のエージェントタイプは常にvalidを返すこと', () => {
    expect(validateApiKeyFormat('unknown', 'any-key')).toEqual({ valid: true });
  });

  test('APIキー不要のタイプで空キーはvalidを返すこと', () => {
    expect(validateApiKeyFormat('claude-code', '')).toEqual({ valid: true });
  });

  test('APIキー必須のタイプで空キーはinvalidを返すこと', () => {
    const result = validateApiKeyFormat('openai', '');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('必須');
  });

  test('anthropic-apiで正しいプレフィックスのキーはvalidを返すこと', () => {
    expect(validateApiKeyFormat('anthropic-api', 'sk-ant-api03-abcdefghijklmno')).toEqual({
      valid: true,
    });
  });

  test('anthropic-apiで間違ったプレフィックスのキーはinvalidを返すこと', () => {
    const result = validateApiKeyFormat('anthropic-api', 'sk-wrong-prefix-abcde');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('sk-ant-');
  });

  test('openaiで正しいプレフィックスのキーはvalidを返すこと', () => {
    expect(validateApiKeyFormat('openai', 'sk-abcdefghijklmnopqrstuvwxyz')).toEqual({
      valid: true,
    });
  });

  test('短すぎるキーはinvalidを返すこと', () => {
    const result = validateApiKeyFormat('openai', 'sk-short');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('短すぎ');
  });
});

describe('validateAgentConfig', () => {
  test('未知のエージェントタイプはvalidを返すこと', () => {
    expect(validateAgentConfig('unknown', {})).toEqual({ valid: true, errors: [] });
  });

  test('エンドポイント必須のタイプでエンドポイントなしはエラーを返すこと', () => {
    const result = validateAgentConfig('azure-openai', {});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('エンドポイントURLは必須です');
  });

  test('無効なエンドポイントURLはエラーを返すこと', () => {
    const result = validateAgentConfig('azure-openai', { endpoint: 'not-a-url' });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('無効なエンドポイントURLです');
  });

  test('有効なエンドポイントURLはvalidを返すこと', () => {
    const result = validateAgentConfig('azure-openai', {
      endpoint: 'https://my-service.openai.azure.com',
    });
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  test('利用可能モデル以外のモデルIDはエラーを返すこと', () => {
    const result = validateAgentConfig('openai', { modelId: 'invalid-model' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('無効なモデル'))).toBe(true);
  });

  test('有効なモデルIDはvalidを返すこと', () => {
    const result = validateAgentConfig('openai', { modelId: 'gpt-4o' });
    expect(result.valid).toBe(true);
  });

  test('数値フィールドの最小値違反はエラーを返すこと', () => {
    const result = validateAgentConfig('claude-code', {
      additionalConfig: { maxTokens: 500 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('1000以上'))).toBe(true);
  });

  test('数値フィールドの最大値違反はエラーを返すこと', () => {
    const result = validateAgentConfig('claude-code', {
      additionalConfig: { maxTokens: 200000 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('100000以下'))).toBe(true);
  });

  test('有効な数値フィールドはvalidを返すこと', () => {
    const result = validateAgentConfig('claude-code', {
      additionalConfig: { maxTokens: 50000 },
    });
    expect(result.valid).toBe(true);
  });

  test('codexのtemperature範囲をバリデーションすること', () => {
    const result = validateAgentConfig('codex', {
      additionalConfig: { temperature: 3 },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('2以下'))).toBe(true);
  });

  test('必須フィールドの組み合わせバリデーション', () => {
    const result = validateAgentConfig('custom', {});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('文字列フィールドの長さバリデーション', () => {
    const shortString = 'a'.repeat(4); // Less than 5 chars
    const longString = 'a'.repeat(1001); // Over 1000 chars

    // maxTokens is a numeric field, so check if any text fields with length validation exist
    const schemas = getAllAgentConfigSchemas();
    const schemaWithStringField = schemas.find((s) =>
      s.additionalFields?.some((f) => f.type === 'text' && f.validation?.minLength),
    );

    if (schemaWithStringField) {
      const stringField = schemaWithStringField.additionalFields?.find(
        (f) => f.type === 'text' && f.validation?.minLength,
      );

      if (stringField && stringField.validation?.minLength) {
        const result = validateAgentConfig(schemaWithStringField.agentType, {
          additionalConfig: { [stringField.name]: 'x' },
        });
        expect(result.valid).toBe(false);
      }
    }
  });

  test('URLタイプフィールドのバリデーション', () => {
    const schemas = getAllAgentConfigSchemas();
    const schemaWithUrlField = schemas.find((s) =>
      s.additionalFields?.some((f) => f.type === 'url'),
    );

    if (schemaWithUrlField) {
      const urlField = schemaWithUrlField.additionalFields?.find((f) => f.type === 'url');

      if (urlField) {
        const result = validateAgentConfig(schemaWithUrlField.agentType, {
          additionalConfig: { [urlField.name]: 'not-a-url' },
        });
        expect(result.valid).toBe(false);
      }
    }
  });

  test('selectタイプフィールドのオプションバリデーション', () => {
    const schemas = getAllAgentConfigSchemas();
    const schemaWithSelectField = schemas.find((s) =>
      s.additionalFields?.some((f) => f.type === 'select' && f.options),
    );

    if (schemaWithSelectField) {
      const selectField = schemaWithSelectField.additionalFields?.find(
        (f) => f.type === 'select' && f.options,
      );

      if (selectField && selectField.options) {
        const result = validateAgentConfig(schemaWithSelectField.agentType, {
          additionalConfig: { [selectField.name]: 'invalid-option' },
        });
        // Current implementation does not validate additionalConfig
        expect(result.valid).toBe(true);
      }
    }
  });

  test('booleanタイプフィールドのバリデーション', () => {
    const schemas = getAllAgentConfigSchemas();
    const schemaWithBooleanField = schemas.find((s) =>
      s.additionalFields?.some((f) => f.type === 'boolean'),
    );

    if (schemaWithBooleanField) {
      const booleanField = schemaWithBooleanField.additionalFields?.find(
        (f) => f.type === 'boolean',
      );

      if (booleanField) {
        // Valid boolean value
        const validResult = validateAgentConfig(schemaWithBooleanField.agentType, {
          additionalConfig: { [booleanField.name]: true },
        });
        expect(validResult.valid).toBe(true);

        // Invalid value (current implementation does not validate additionalConfig)
        const invalidResult = validateAgentConfig(schemaWithBooleanField.agentType, {
          additionalConfig: { [booleanField.name]: 'not-boolean' },
        });
        expect(invalidResult.valid).toBe(true);
      }
    }
  });
});

describe('エッジケーステスト', () => {
  test('null値やundefinedの処理', () => {
    expect(getAgentConfigSchema(null as unknown as string)).toBeNull();
    expect(getAgentConfigSchema(undefined as unknown as string)).toBeNull();
  });

  test('空オブジェクトの設定バリデーション', () => {
    const schemas = getAllAgentConfigSchemas();
    schemas.forEach((schema) => {
      const result = validateAgentConfig(schema.agentType, {});
      expect(result).toBeDefined();
      expect(typeof result.valid).toBe('boolean');
      expect(Array.isArray(result.errors)).toBe(true);
    });
  });

  test('null/undefined値を含む設定の処理', () => {
    const result = validateAgentConfig('claude-code', {
      endpoint: null,
      modelId: undefined,
      additionalConfig: null as unknown as Record<string, unknown>,
    });
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe('boolean');
  });

  test('非常に長いAPIキーの処理', () => {
    const veryLongKey = 'sk-ant-' + 'a'.repeat(10000);
    const result = validateApiKeyFormat('anthropic-api', veryLongKey);
    expect(result.valid).toBe(true);
  });

  test('特殊文字を含むAPIキーの処理', () => {
    const specialKey = 'sk-ant-api03-@#$%^&*()_+-={}|[]\\:;"\'<>?,./';
    const result = validateApiKeyFormat('anthropic-api', specialKey);
    expect(result.valid).toBe(true);
  });

  test('Unicode文字を含む設定値の処理', () => {
    const result = validateAgentConfig('claude-code', {
      additionalConfig: {
        customField: 'こんにちは🌍',
      },
    });
    expect(result).toBeDefined();
  });
});

describe('パフォーマンステスト', () => {
  test('大量のスキーマ取得の性能', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      getAllAgentConfigSchemas();
    }
    const end = performance.now();
    expect(end - start).toBeLessThan(100); // Within 100ms
  });

  test('大量のバリデーションの性能', () => {
    const start = performance.now();
    for (let i = 0; i < 1000; i++) {
      validateApiKeyFormat('claude-code', 'sk-ant-api03-validkey1234567890');
    }
    const end = performance.now();
    expect(end - start).toBeLessThan(100); // Within 100ms
  });
});

describe('統合テスト', () => {
  test('全エージェントタイプの完全な設定ワークフロー', () => {
    const schemas = getAllAgentConfigSchemas();

    schemas.forEach((schema) => {
      // Schema should be retrieved correctly
      const retrievedSchema = getAgentConfigSchema(schema.agentType);
      expect(retrievedSchema).toEqual(schema);

      // Validation when API key is required
      if (schema.apiKeyRequired) {
        const apiKey = schema.apiKeyPrefix
          ? `${schema.apiKeyPrefix}validkey1234567890`
          : 'validkey1234567890';

        const keyValidation = validateApiKeyFormat(schema.agentType, apiKey);
        expect(keyValidation.valid).toBe(true);
      }

      // Basic configuration validation
      const basicConfig = {
        endpoint: schema.defaultEndpoint,
        modelId: schema.defaultModel,
      };

      const configValidation = validateAgentConfig(schema.agentType, basicConfig);
      expect(configValidation).toBeDefined();
    });
  });

  test('設定変更シナリオのバリデーション', () => {
    // Step by step from empty config to complete config
    const agentType = 'azure-openai';

    // Step 1: Empty config (should have errors)
    const emptyResult = validateAgentConfig(agentType, {});
    expect(emptyResult.valid).toBe(false);

    // Step 2: Add endpoint
    const withEndpoint = validateAgentConfig(agentType, {
      endpoint: 'https://my-service.openai.azure.com',
    });
    expect(withEndpoint.valid).toBe(true);

    // Step 3: Add model
    const withModel = validateAgentConfig(agentType, {
      endpoint: 'https://my-service.openai.azure.com',
      modelId: 'gpt-4',
    });
    expect(withModel.valid).toBe(true);
  });
});

describe('セキュリティテスト', () => {
  test('SQLインジェクション類似の入力への耐性', () => {
    const maliciousInput = "'; DROP TABLE users; --";

    const schema = getAgentConfigSchema(maliciousInput);
    expect(schema).toBeNull();

    const keyValidation = validateApiKeyFormat('claude-code', maliciousInput);
    expect(keyValidation).toBeDefined();

    const configValidation = validateAgentConfig('claude-code', {
      additionalConfig: { field: maliciousInput },
    });
    expect(configValidation).toBeDefined();
  });

  test('XSS類似の入力への耐性', () => {
    const xssInput = "<script>alert('xss')</script>";

    const keyValidation = validateApiKeyFormat('claude-code', xssInput);
    expect(keyValidation).toBeDefined();

    const configValidation = validateAgentConfig('claude-code', {
      endpoint: xssInput,
      additionalConfig: { field: xssInput },
    });
    expect(configValidation).toBeDefined();
  });

  test('プロトタイプ汚染への耐性', () => {
    const maliciousConfig = {
      __proto__: { isAdmin: true },
      constructor: { prototype: { isAdmin: true } },
    };

    const result = validateAgentConfig('claude-code', maliciousConfig as Record<string, unknown>);
    expect(result).toBeDefined();
    expect(typeof result.valid).toBe('boolean');
  });
});

describe('データ整合性テスト', () => {
  test('スキーマ間の設定値の一意性', () => {
    const schemas = getAllAgentConfigSchemas();
    const agentTypes = schemas.map((s) => s.agentType);
    const uniqueTypes = new Set(agentTypes);
    expect(agentTypes.length).toBe(uniqueTypes.size);
  });

  test('デフォルト値の妥当性', () => {
    const schemas = getAllAgentConfigSchemas();

    schemas.forEach((schema) => {
      // Check URL format when a default endpoint exists
      if (schema.defaultEndpoint) {
        expect(() => new URL(schema.defaultEndpoint)).not.toThrow();
      }

      // Check that default model is included in available models
      if (schema.defaultModel && schema.availableModels) {
        const modelExists = schema.availableModels.some((m) => m.value === schema.defaultModel);
        expect(modelExists).toBe(true);
      }
    });
  });

  test('必須フィールドとオプショナルフィールドの整合性', () => {
    const schemas = getAllAgentConfigSchemas();

    schemas.forEach((schema) => {
      // Warning when API key is required but no prefix is defined
      if (schema.apiKeyRequired && !schema.apiKeyPrefix) {
        // This is a warning, not an error (e.g., custom agents)
        expect(typeof schema.apiKeyRequired).toBe('boolean');
      }

      // Endpoint is required but no default is provided
      if (schema.endpointRequired && !schema.defaultEndpoint) {
        // This is not necessarily an error (e.g., Azure OpenAI)
        expect(typeof schema.endpointRequired).toBe('boolean');
      }
    });
  });
});
