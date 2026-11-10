/**
 * model-tier-table/configured-vendors
 *
 * The vendors this host is actually set up to call for an auxiliary review,
 * read from the real configuration: in API mode, the providers with an API key
 * (UserSettings, or CLAUDE_API_KEY for Claude — the same lookup the API call
 * itself uses, credentials.getApiKeyForProvider); in CLI mode,
 * Anthropic only when the Claude Code CLI is installed and answers. Cooldowns
 * (quota / rate limit / auth failures) are layered on top by
 * usable-vendors.ts. Not responsible for choosing seats.
 *
 * NOTE: The CLI check proves the binary runs (`claude --version`, memoised for
 * the process), not that its login is valid — the CLI has no cheap auth probe.
 * An auth failure on a real call puts the provider in cooldown, which
 * usable-vendors.ts then removes.
 */
import { createLogger } from '../../../config/logger';
import type { AIProvider } from '../../../utils/ai-client/types';
import type { AuxAiMode } from '../../../utils/ai-client/aux-ai-mode';
import { vendorOfProvider, type ModelVendor } from './tier-table';

const log = createLogger('model-tier-table:configured-vendors');

/** Providers a review can be sent to in API mode, in route order. */
const API_PROVIDERS: AIProvider[] = ['claude', 'chatgpt', 'gemini'];

/** Vendors set up on this host, and why the others are not. */
export interface ConfiguredVendors {
  configured: ModelVendor[];
  unconfigured: Array<{ vendor: ModelVendor; reason: string }>;
}

/**
 * Resolve the vendors configured for the given auxiliary AI mode.
 *
 * Fails closed: a configuration that cannot be read counts as not configured,
 * so a seat is left unmet rather than sent to a vendor that cannot answer.
 *
 * @param auxMode - Auxiliary AI mode / 補助AIのモード
 * @returns Configured vendors plus reasons for the rest / 設定済みのベンダー
 */
export async function resolveConfiguredVendors(auxMode: AuxAiMode): Promise<ConfiguredVendors> {
  if (auxMode === 'off') {
    // Auxiliary AI is disabled on this host: no vendor may be called.
    return {
      configured: [],
      unconfigured: (['anthropic', 'openai', 'google'] as const).map((vendor) => ({
        vendor,
        reason: '補助AIが無効（RAPITAS_AUX_AI=off）',
      })),
    };
  }
  if (auxMode === 'cli') {
    // NOTE: CLI aux mode sends every call through the Claude Code CLI
    // (sendAIMessage ignores the provider there), so Anthropic is the only
    // vendor this host can seat, and only when that CLI runs.
    const available = await import('../../../utils/ai-client/claude-cli-provider')
      .then((m) => m.isClaudeCliAvailable())
      .catch((err) => {
        log.warn({ err }, 'Claude CLI availability check failed — treating it as unavailable');
        return false;
      });
    return available
      ? { configured: ['anthropic'], unconfigured: [] }
      : {
          configured: [],
          unconfigured: [{ vendor: 'anthropic', reason: 'Claude CLI が見つからない・起動しない' }],
        };
  }

  const configured: ModelVendor[] = [];
  const unconfigured: ConfiguredVendors['unconfigured'] = [];
  const { getApiKeyForProvider } = await import('../../../utils/ai-client/credentials');
  for (const provider of API_PROVIDERS) {
    const vendor = vendorOfProvider(provider);
    if (!vendor) continue;
    const key = await getApiKeyForProvider(provider).catch(() => null);
    if (key) configured.push(vendor);
    else unconfigured.push({ vendor, reason: 'API キーが設定されていない' });
  }
  return { configured, unconfigured };
}
