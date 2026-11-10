/**
 * claude-cli-usage
 *
 * Extracts the cost and token breakdown from one `claude --print
 * --output-format json` result. Pure; spawning and parsing the process output
 * stay in claude-cli-provider.ts.
 */
import type { AIResponse } from './types';
function finiteOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
}

/**
 * Cost and token breakdown from the CLI's `--output-format json` result.
 *
 * NOTE: These used to be dropped (only input+output tokens were returned), so
 * no auxiliary call — jury, critic, Rapi — ever had a recorded cost. A one-shot
 * `--print` is a fresh session, so `total_cost_usd` is this call's own cost
 * (unlike the agent's resumed sessions, where it is cumulative).
 *
 * @param parsed - Parsed CLI result object / 解析済みのCLI結果
 * @returns Optional usage fields for AIResponse / AIResponse の任意フィールド
 */
export function cliUsageFields(parsed: {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  total_cost_usd?: number;
  modelUsage?: Record<string, unknown>;
}): Pick<
  AIResponse,
  | 'costUsd'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheReadInputTokens'
  | 'cacheCreationInputTokens'
  | 'modelName'
> {
  const fields = {
    costUsd: finiteOrUndefined(parsed.total_cost_usd),
    inputTokens: finiteOrUndefined(parsed.usage?.input_tokens),
    outputTokens: finiteOrUndefined(parsed.usage?.output_tokens),
    cacheReadInputTokens: finiteOrUndefined(parsed.usage?.cache_read_input_tokens),
    cacheCreationInputTokens: finiteOrUndefined(parsed.usage?.cache_creation_input_tokens),
    // modelUsage is keyed by full model id; the first key is the answering model.
    modelName: parsed.modelUsage ? Object.keys(parsed.modelUsage)[0] : undefined,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
}
