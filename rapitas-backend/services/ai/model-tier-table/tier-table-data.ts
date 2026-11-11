/**
 * model-tier-table/tier-table-data
 *
 * The rows of the model tier table. Data only — every value here was read off
 * the vendor's own model list / pricing page on `checkedAt` (追補4: 公式情報を
 * 正とする); anything those pages did not state is listed in `unverified`.
 *
 * NOTE: Placement (the `tier` and `roles` columns) is an organisational
 * decision, not a measurement. It follows each vendor's official positioning
 * (top class = premium, workhorse = standard, fast/low-cost = economy) and
 * changes only through an approved table update (追補3). Do not "correct" a
 * tier here from a benchmark or a news article.
 */
import type { ModelTierEntry, RoleSuitability } from './tier-table-types';

const CHECKED_AT = '2026-11-10';

const ANTHROPIC_SOURCES = [
  'https://platform.claude.com/docs/en/about-claude/models/overview',
  'https://platform.claude.com/docs/en/about-claude/pricing',
] as const;

const openAiSources = (modelId: string): readonly string[] => [
  'https://platform.openai.com/docs/models',
  `https://developers.openai.com/api/docs/models/${modelId}`,
  'https://developers.openai.com/api/docs/pricing',
  'https://developers.openai.com/codex/models',
];

const googleSources = (modelId: string): readonly string[] => [
  'https://ai.google.dev/gemini-api/docs/models',
  `https://ai.google.dev/gemini-api/docs/models/${modelId}`,
  'https://ai.google.dev/gemini-api/docs/pricing',
];

/** Premium and standard rows may fill every role. */
const ALL_ROLES: RoleSuitability = {
  execute: true,
  review: true,
  orchestrate: true,
  research: true,
};

/**
 * Economy rows never judge someone else's work: a reviewer must be at least
 * as capable as the usual implementer, and economy sits below it.
 */
const ECONOMY_ROLES: RoleSuitability = {
  execute: true,
  review: false,
  orchestrate: false,
  research: true,
};

/**
 * NOTE: The Claude Code CLI aliases (opus / sonnet / haiku) resolve on the
 * CLI's side; Anthropic's model list does not say which snapshot an alias
 * reaches today, so the alias→row link is recorded as unverified.
 */
const CLI_ALIAS_UNVERIFIED =
  'CLI エイリアスの解決先（Claude Code 側の対応。公式のモデル一覧には記載なし）';

/** Every registered model, highest tier first within each vendor. */
export const MODEL_TIER_TABLE: readonly ModelTierEntry[] = [
  {
    modelId: 'claude-fable-5-2',
    aliases: [],
    cliAlias: null,
    codexCliModel: null,
    displayName: 'Claude Fable 5.2',
    vendor: 'anthropic',
    tier: 'premium',
    price: { input: 8, output: 40 },
    contextTokens: 1_000_000,
    speed: 'Moderate',
    roles: ALL_ROLES,
    notes:
      '公式の位置づけ「For demanding reasoning and long-horizon agentic work」。現行ラインの最上位で Opus より高価。' +
      'Claude Code の CLI 別名が確認できないため、CLI 経路の席には置かない（現行の CLI プロバイダは未知の ID を haiku で起動する）。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: ANTHROPIC_SOURCES,
    unverified: ['CLI 別名'],
  },
  {
    modelId: 'claude-opus-5-5',
    aliases: ['opus'],
    cliAlias: 'opus',
    codexCliModel: null,
    displayName: 'Claude Opus 5.5',
    vendor: 'anthropic',
    tier: 'premium',
    price: { input: 4, output: 20 },
    contextTokens: 1_000_000,
    speed: 'Moderate',
    roles: ALL_ROLES,
    notes:
      '公式の位置づけ「For long-running agentic coding and knowledge work」。公式が「迷ったらまずこれ」と案内する主力の上位モデル。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: ANTHROPIC_SOURCES,
    unverified: [CLI_ALIAS_UNVERIFIED],
  },
  {
    modelId: 'claude-sonnet-5-5',
    aliases: ['sonnet'],
    cliAlias: 'sonnet',
    codexCliModel: null,
    displayName: 'Claude Sonnet 5.5',
    vendor: 'anthropic',
    tier: 'standard',
    price: { input: 2, output: 10 },
    contextTokens: 1_000_000,
    speed: 'Fast',
    roles: ALL_ROLES,
    notes: '公式の位置づけ「The best combination of speed and intelligence」。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: ANTHROPIC_SOURCES,
    unverified: [CLI_ALIAS_UNVERIFIED],
  },
  {
    modelId: 'claude-haiku-5-5',
    aliases: ['haiku'],
    cliAlias: 'haiku',
    codexCliModel: null,
    displayName: 'Claude Haiku 5.5',
    vendor: 'anthropic',
    tier: 'economy',
    price: {
      input: 0.1,
      output: 0.5,
      note: 'プロンプト 100,000 トークン以下の価格。超える場合は入力 $0.50／出力 $2.50',
    },
    contextTokens: 1_000_000,
    speed: 'Fastest',
    roles: ECONOMY_ROLES,
    notes:
      '公式の位置づけ「For high-volume, latency-sensitive tasks such as classification, extraction, and routing」。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: ANTHROPIC_SOURCES,
    unverified: [CLI_ALIAS_UNVERIFIED],
  },
  {
    modelId: 'gpt-6-astra',
    aliases: [],
    cliAlias: null,
    codexCliModel: 'gpt-6-astra',
    displayName: 'GPT-6 Astra',
    vendor: 'openai',
    tier: 'premium',
    price: { input: 10, output: 50 },
    contextTokens: 1_050_000,
    speed: 'Fast',
    roles: ALL_ROLES,
    notes:
      'OpenAI の旗艦（「Our most capable model for the most demanding work」）。Codex では `codex -m gpt-6-astra`。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: openAiSources('gpt-6-astra'),
    unverified: [],
  },
  {
    modelId: 'gpt-6.1-sol',
    aliases: [],
    cliAlias: null,
    codexCliModel: 'gpt-6.1-sol',
    displayName: 'GPT-6.1 Sol',
    vendor: 'openai',
    tier: 'standard',
    price: { input: 2, output: 10 },
    contextTokens: 1_050_000,
    speed: 'Fast',
    roles: ALL_ROLES,
    notes:
      '「Near-Astra performance for complex work at a lower cost」。Codex の推奨既定（config.toml の例）で、Codex の既定コンテキストは 500,000。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: openAiSources('gpt-6.1-sol'),
    unverified: [],
  },
  {
    modelId: 'gpt-6.1-terra',
    aliases: [],
    cliAlias: null,
    codexCliModel: 'gpt-6.1-terra',
    displayName: 'GPT-6.1 Terra',
    vendor: 'openai',
    tier: 'economy',
    price: { input: 1, output: 5 },
    contextTokens: 1_050_000,
    speed: 'Fast',
    roles: ECONOMY_ROLES,
    notes:
      '「A fast, efficient model for visual reasoning, precise computer use, and clear, natural writing」。コーディング向けとは案内されていない。Codex CLI 0.159.0 以降。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: openAiSources('gpt-6.1-terra'),
    unverified: [],
  },
  {
    modelId: 'gpt-6-luna',
    aliases: [],
    cliAlias: null,
    codexCliModel: 'gpt-6-luna',
    displayName: 'GPT-6 Luna',
    vendor: 'openai',
    tier: 'economy',
    price: { input: 0.1, output: 0.5 },
    contextTokens: 1_050_000,
    speed: 'Fast',
    roles: ECONOMY_ROLES,
    notes: '「Our most efficient model for focused, high-volume tasks」。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: openAiSources('gpt-6-luna'),
    unverified: [],
  },
  {
    modelId: 'gpt-5.3-codex',
    aliases: [],
    cliAlias: null,
    codexCliModel: null,
    displayName: 'GPT-5.3-Codex',
    vendor: 'openai',
    tier: 'standard',
    price: { input: 1.75, output: 14 },
    contextTokens: 400_000,
    speed: 'Medium',
    roles: { execute: true, review: false, orchestrate: false, research: false },
    notes:
      '公式で Deprecated（ChatGPT サインインの Codex では非推奨、API キー経由は利用可）。分類用に残し、席には置かない。',
    status: 'deprecated',
    checkedAt: CHECKED_AT,
    sources: openAiSources('gpt-5.3-codex'),
    unverified: [],
  },
  {
    modelId: 'gemini-4-argon',
    aliases: [],
    cliAlias: null,
    codexCliModel: null,
    displayName: 'Gemini 4 Argon',
    vendor: 'google',
    tier: 'premium',
    price: {
      input: 2,
      output: 10,
      note: '2026-11-30 までの価格。2026-12-01 から入力 $4.00／出力 $20.00',
    },
    contextTokens: 1_000_000,
    speed: '未確認',
    roles: ALL_ROLES,
    notes: 'Google の旗艦推論モデル（「Our flagship reasoning model」）。Free tier では使えない。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: googleSources('gemini-4-argon'),
    unverified: ['速度'],
  },
  {
    modelId: 'gemini-3.8-flash',
    aliases: [],
    cliAlias: null,
    codexCliModel: null,
    displayName: 'Gemini 3.8 Flash',
    vendor: 'google',
    tier: 'standard',
    price: {
      input: 0.75,
      output: 3.75,
      note: '2026-12-31 までの価格。2027-01-01 から入力 $1.50／出力 $7.50',
    },
    contextTokens: 1_048_576,
    speed: '未確認',
    roles: ALL_ROLES,
    notes:
      '「Our most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents」。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: googleSources('gemini-3.8-flash'),
    unverified: ['速度'],
  },
  {
    modelId: 'gemini-3.5-flash-lite',
    aliases: [],
    cliAlias: null,
    codexCliModel: null,
    displayName: 'Gemini 3.5 Flash-Lite',
    vendor: 'google',
    tier: 'economy',
    price: { input: 0.3, output: 2.5 },
    contextTokens: 1_048_576,
    speed: '未確認',
    roles: ECONOMY_ROLES,
    notes:
      '「A cost-efficient model, optimized for high-volume agentic tasks, translation, and simple data processing」。',
    status: 'current',
    checkedAt: CHECKED_AT,
    sources: googleSources('gemini-3.5-flash-lite'),
    unverified: ['速度'],
  },
];
