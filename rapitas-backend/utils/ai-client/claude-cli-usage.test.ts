/**
 * claude-cli-usage.test
 *
 * The subscription CLI's JSON result carries the call's cost and token
 * breakdown; these used to be dropped, so no auxiliary call had a cost.
 */
import { describe, expect, test } from 'bun:test';
import { cliUsageFields } from './claude-cli-usage';

describe('cliUsageFields', () => {
  test('extracts total_cost_usd, the four token classes and the answering model', () => {
    expect(
      cliUsageFields({
        total_cost_usd: 0.0123,
        usage: {
          input_tokens: 10,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 40,
        },
        modelUsage: { 'claude-sonnet-4-5-20250929': {} },
      }),
    ).toEqual({
      costUsd: 0.0123,
      inputTokens: 10,
      outputTokens: 20,
      cacheReadInputTokens: 30,
      cacheCreationInputTokens: 40,
      modelName: 'claude-sonnet-4-5-20250929',
    });
  });

  test('omits what the CLI did not report (no zero-filled cost)', () => {
    expect(cliUsageFields({ usage: { input_tokens: 5 } })).toEqual({ inputTokens: 5 });
    expect(cliUsageFields({})).toEqual({});
  });

  test('ignores non-finite or negative numbers', () => {
    expect(cliUsageFields({ total_cost_usd: Number.NaN, usage: { output_tokens: -1 } })).toEqual(
      {},
    );
  });
});
