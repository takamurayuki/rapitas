/**
 * agent-models
 *
 * Thin adapter that turns the dynamic `model-discovery` results into the
 * `{value, label, description}` shape expected by the AI agent management UI.
 *
 * Hardcoded fallback lists were removed in favour of the unified probe
 * pipeline — Anthropic/OpenAI/Google REST first, CLI introspection second,
 * and Ollama via local HTTP. This module exists purely to (a) bucket models
 * by agent type and (b) translate field names; all "is this model real
 * today" intelligence lives in `services/ai/model-discovery`.
 */
import {
  discoverModels,
  type DiscoveredModel,
  type Provider,
} from '../../services/ai/model-discovery';

type ModelInfo = {
  value: string;
  label: string;
  description?: string;
};

/** Map agentType (DB column) → discovery `Provider`. */
const AGENT_TYPE_TO_PROVIDER: Record<string, Provider> = {
  'claude-code': 'claude',
  claude: 'claude',
  'anthropic-api': 'claude',
  codex: 'openai',
  openai: 'openai',
  'azure-openai': 'openai',
  chatgpt: 'openai',
  gemini: 'gemini',
  'gemini-cli': 'gemini',
  ollama: 'ollama',
};

/** All agentType values surfaced by `getAllModels`. Custom agents are excluded. */
const SUPPORTED_AGENT_TYPES = Object.keys(AGENT_TYPE_TO_PROVIDER);

const PROVIDER_FALLBACK_MODELS: Record<Provider, ModelInfo[]> = {
  claude: [
    {
      value: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
      description: 'バランス型（Fallback）',
    },
    { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', description: '軽量・高速（Fallback）' },
  ],
  openai: [
    { value: 'gpt-5.1', label: 'GPT-5.1', description: '最高性能（Fallback）' },
    { value: 'gpt-5.1-mini', label: 'GPT-5.1 Mini', description: '軽量・高速（Fallback）' },
  ],
  gemini: [
    { value: 'gemini-3-pro', label: 'Gemini 3 Pro', description: '最高性能（Fallback）' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: '軽量・高速（Fallback）' },
  ],
  ollama: [],
};

/** Convert a discovered model to UI-friendly shape. */
function toModelInfo(m: DiscoveredModel): ModelInfo {
  return {
    value: m.id,
    label: m.label || m.id,
    description: tierDescription(m),
  };
}

/** Short JP description derived from tier + source for UX clarity. */
function tierDescription(m: DiscoveredModel): string {
  const tierLabel =
    m.tier === 'premium'
      ? '最高性能'
      : m.tier === 'standard'
        ? 'バランス型'
        : m.tier === 'economy'
          ? '軽量・高速'
          : 'ローカル';
  const sourceLabel = m.source === 'rest-api' ? 'REST' : m.source === 'cli-alias' ? 'CLI' : 'Local';
  return `${tierLabel}（${sourceLabel}）`;
}

/**
 * Return models for a single agent type. Empty when the underlying provider
 * is currently unreachable or the agentType is unrecognised.
 *
 * @param agentType - DB-stored agent type (e.g. `claude-code`, `gemini`). / エージェント種別
 * @returns Available models for that type. / 利用可能モデル一覧
 */
export async function getModelsForAgentType(agentType: string): Promise<ModelInfo[]> {
  const provider = AGENT_TYPE_TO_PROVIDER[agentType];
  if (!provider) return [];
  const { models } = await discoverModels();
  const discovered = models.filter((m) => m.provider === provider).map(toModelInfo);
  return discovered.length > 0 ? discovered : PROVIDER_FALLBACK_MODELS[provider];
}

/**
 * Return all available models keyed by agentType. Each agentType ends up with
 * the same model list its provider exposes — `claude-code` and
 * `anthropic-api` both surface the Claude family, etc.
 *
 * @returns `{ [agentType]: ModelInfo[] }`. / エージェント種別ごとのモデル一覧
 */
export async function getAllModels(): Promise<Record<string, ModelInfo[]>> {
  const { models } = await discoverModels();
  const byProvider = new Map<Provider, ModelInfo[]>();
  for (const m of models) {
    const list = byProvider.get(m.provider) ?? [];
    list.push(toModelInfo(m));
    byProvider.set(m.provider, list);
  }

  const result: Record<string, ModelInfo[]> = {};
  for (const agentType of SUPPORTED_AGENT_TYPES) {
    const provider = AGENT_TYPE_TO_PROVIDER[agentType];
    result[agentType] = byProvider.get(provider) ?? PROVIDER_FALLBACK_MODELS[provider];
  }
  return result;
}
