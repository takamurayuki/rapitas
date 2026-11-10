/**
 * model-tier-table/tier-table-types
 *
 * Types for the model tier table — the single source of truth for which tier a
 * model sits in, what it costs, and which roles it may fill. Types only; the
 * rows live in tier-table-data.ts and the lookups in tier-table.ts.
 */

/** Vendor (model family owner). Distinct from the runtime `Provider` route. */
export type ModelVendor = 'anthropic' | 'openai' | 'google';

/** Capability tier as placed in the table. Local `free` models are not tabled. */
export type TableTier = 'premium' | 'standard' | 'economy';

/** Organisational roles a model may fill (追補3: 実行／レビュー／統括／調査). */
export interface RoleSuitability {
  /** 実行 — implementer and other phases that write the change. */
  execute: boolean;
  /** レビュー — reviewer and verifier seats that judge someone else's work. */
  review: boolean;
  /** 統括 — planner / orchestration. */
  orchestrate: boolean;
  /** 調査 — researcher. */
  research: boolean;
}

/** USD per 1M tokens, standard (non-batch, non-fast) rate. */
export interface TablePrice {
  input: number | null;
  output: number | null;
  /** Caveats from the official page (promotional period, prompt-length bands …). */
  note?: string;
}

/** One row of the tier table. */
export interface ModelTierEntry {
  /** Official API model id. */
  modelId: string;
  /** Other ids that resolve to this row (CLI aliases, dated variants). */
  aliases: readonly string[];
  /**
   * The Claude Code `--model` alias that reaches this model in CLI aux mode,
   * or null when no CLI route is confirmed (the row is then never seated on
   * the CLI host).
   */
  cliAlias: 'opus' | 'sonnet' | 'haiku' | null;
  displayName: string;
  vendor: ModelVendor;
  tier: TableTier;
  price: TablePrice;
  /** Context window in tokens, null when not confirmed. */
  contextTokens: number | null;
  /** Speed label as worded by the vendor, or '未確認'. */
  speed: string;
  roles: RoleSuitability;
  /** Characteristics worth knowing when placing the model. */
  notes: string;
  /** `current` rows are seatable; `deprecated` rows only classify an id. */
  status: 'current' | 'deprecated';
  /** Date (YYYY-MM-DD) the row was last checked against the sources. */
  checkedAt: string;
  /** Official pages the row was checked against (追補4). */
  sources: readonly string[];
  /** Fields the official pages did not state (書かれていない項目). */
  unverified: readonly string[];
}
