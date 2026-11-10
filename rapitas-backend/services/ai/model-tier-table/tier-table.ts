/**
 * model-tier-table/tier-table
 *
 * Lookups over the model tier table: which row an id is, its tier, its price
 * and which roles it may fill, plus the conservative default for ids the table
 * does not know. Every tier judgement in routing and seat resolution goes
 * through here. Not responsible for name heuristics (tier-classifier.ts keeps
 * those for unregistered ids) or for choosing a model (seat-planner.ts).
 */
import { MODEL_TIER_TABLE } from './tier-table-data';
import type { ModelTierEntry, ModelVendor, RoleSuitability, TableTier } from './tier-table-types';

/** Tier including local models, which the table does not list. */
export type AnyTier = TableTier | 'free';

/** Highest → lowest capability. Index 0 is the strongest tier. */
export const TIER_ORDER: readonly AnyTier[] = ['premium', 'standard', 'economy', 'free'];

/**
 * The highest tier an unregistered model may be placed in (追補3: 未評価モデルの
 * 既定は standard). A name that merely looks like a flagship is not evidence.
 */
export const UNREGISTERED_TIER_CEILING: TableTier = 'standard';

/**
 * Normalise an id for lookup: case, surrounding space, and the platform
 * prefixes the vendors' own APIs put in front of the same model
 * (`models/gemini-…` from the Gemini API, `anthropic.claude-…` on Bedrock).
 */
function normalise(modelId: string): string {
  return modelId
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
    .replace(/^anthropic\./, '');
}

const BY_ID = new Map<string, ModelTierEntry>();
for (const entry of MODEL_TIER_TABLE) {
  BY_ID.set(normalise(entry.modelId), entry);
  for (const alias of entry.aliases) BY_ID.set(normalise(alias), entry);
}

/**
 * Find the table row for a model id or alias.
 *
 * Exact match only (after normalisation): a dated snapshot or a sibling
 * variant the table does not list is an unregistered model, not this row.
 *
 * @param modelId - Model id or CLI alias / モデルIDまたはCLIエイリアス
 * @returns The row, or null when unregistered / 未登録なら null
 */
export function findModelEntry(modelId: string | null | undefined): ModelTierEntry | null {
  if (!modelId) return null;
  return BY_ID.get(normalise(modelId)) ?? null;
}

/**
 * Rank of a tier, 0 = strongest.
 *
 * @param tier - Tier / ティア
 * @returns Index in TIER_ORDER / 順位
 */
export function tierRank(tier: AnyTier): number {
  return TIER_ORDER.indexOf(tier);
}

/**
 * Whether `tier` is at least as capable as `floor`.
 *
 * @param tier - Candidate tier / 候補ティア
 * @param floor - Required minimum / 下限ティア
 * @returns true when tier ≥ floor / 下限以上なら true
 */
export function tierAtLeast(tier: AnyTier, floor: AnyTier): boolean {
  return tierRank(tier) <= tierRank(floor);
}

/**
 * The stronger of two tiers.
 *
 * @param a - Tier / ティア
 * @param b - Tier / ティア
 * @returns The stronger tier / 強い方
 */
export function strongerTier<T extends AnyTier>(a: T, b: T): T {
  return tierRank(a) <= tierRank(b) ? a : b;
}

/**
 * Cap a heuristic tier for an unregistered model at the conservative default.
 *
 * @param heuristic - Tier the name heuristic suggested / 名前からの推定ティア
 * @returns The tier the router may use / 使ってよいティア
 */
export function capUnregisteredTier(heuristic: AnyTier): AnyTier {
  return tierAtLeast(heuristic, UNREGISTERED_TIER_CEILING) ? UNREGISTERED_TIER_CEILING : heuristic;
}

/**
 * USD per 1K tokens (average of input and output) from the row's price.
 *
 * @param entry - Table row / 表の行
 * @returns USD/1K, or null when either price is unknown / 不明なら null
 */
export function costPer1kOf(entry: ModelTierEntry): number | null {
  const { input, output } = entry.price;
  if (input === null || output === null) return null;
  return (input + output) / 2 / 1000;
}

/**
 * Which vendor a runtime provider name belongs to.
 *
 * Accepts both naming schemes in the backend: model-discovery's `Provider`
 * (`claude` / `openai` / `gemini`) and ai-client's `AIProvider` (`chatgpt`).
 *
 * @param provider - Provider name / プロバイダ名
 * @returns Vendor, or null for local / unknown providers / ローカル・不明は null
 */
export function vendorOfProvider(provider: string | null | undefined): ModelVendor | null {
  switch ((provider ?? '').toLowerCase()) {
    case 'claude':
    case 'anthropic':
      return 'anthropic';
    case 'openai':
    case 'chatgpt':
    case 'codex':
      return 'openai';
    case 'gemini':
    case 'google':
      return 'google';
    default:
      return null;
  }
}

/** Workflow role → the table's role column. */
const ROLE_COLUMN: Record<string, keyof RoleSuitability> = {
  implementer: 'execute',
  verifier: 'review',
  auto_verifier: 'review',
  reviewer: 'review',
  planner: 'orchestrate',
  researcher: 'research',
};

/**
 * The table's role column for a workflow role.
 *
 * @param role - Workflow role (implementer / verifier / …) / ワークフローロール
 * @returns Role column, or null when the role is not tabled / 対応なしは null
 */
export function roleColumnOf(role: string | null | undefined): keyof RoleSuitability | null {
  return role ? (ROLE_COLUMN[role] ?? null) : null;
}

/**
 * Whether a model may fill a workflow role.
 *
 * Unregistered models may execute, plan and research (standard at most), but
 * never review: judging another model's work needs a placed, evaluated model.
 * Deprecated rows may still execute but are never placed in a new seat.
 *
 * @param modelId - Model id / モデルID
 * @param role - Workflow role / ワークフローロール
 * @returns true when the model may take the role / 担当可能なら true
 */
export function isSuitableForRole(modelId: string, role: string | null | undefined): boolean {
  const column = roleColumnOf(role);
  if (!column) return true;
  const entry = findModelEntry(modelId);
  if (!entry) return column !== 'review';
  if (entry.status !== 'current' && column === 'review') return false;
  return entry.roles[column];
}

/**
 * Current rows a seat may be filled from.
 *
 * @param opts.vendors - Vendors usable right now / いま使えるベンダー
 * @param opts.cliOnly - Only rows reachable through the Claude Code CLI / CLI経路のみ
 * @returns Current rows, table order / 表の順の行
 */
export function seatableEntries(opts: {
  vendors: Iterable<ModelVendor>;
  cliOnly?: boolean;
}): ModelTierEntry[] {
  const vendors = new Set(opts.vendors);
  return MODEL_TIER_TABLE.filter(
    (e) =>
      e.status === 'current' && vendors.has(e.vendor) && (!opts.cliOnly || e.cliAlias !== null),
  );
}

export { MODEL_TIER_TABLE };
export type { ModelTierEntry, ModelVendor, RoleSuitability, TableTier };
