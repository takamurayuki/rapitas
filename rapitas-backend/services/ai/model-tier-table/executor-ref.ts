/**
 * model-tier-table/executor-ref
 *
 * The planner's description of the model whose work is reviewed (the
 * executor): vendor, tier, and whether a run record confirmed it. Not
 * responsible for finding that model (executor-model.ts).
 */
import { observedTier } from '../model-discovery/tier-classifier';
import { findModelEntry, type AnyTier, type ModelVendor } from './tier-table';

/**
 * The model that did the work being reviewed.
 *
 * `verified: false` means the executor could not be established from the
 * task's execution record. Its tier is then assumed to be the strongest
 * (premium), so "a reviewer is at least the executor's tier" is never
 * satisfied by a guess that happens to be low.
 */
export interface ExecutorRef {
  modelId: string | null;
  vendor: ModelVendor | null;
  tier: AnyTier;
  verified: boolean;
}

/** The executor when nothing about it is known: assumed premium. */
export const UNVERIFIED_EXECUTOR: ExecutorRef = {
  modelId: null,
  vendor: null,
  tier: 'premium',
  verified: false,
};

/**
 * Describe the executor for planning from a model id.
 *
 * A registered id takes its row's canonical id, vendor and tier (so the alias
 * `sonnet` and `claude-sonnet-5-5` are the same model). An unregistered id
 * takes the UNCAPPED name tier: the standard cap is a placement rule for
 * unevaluated models, and applied to an executor it would lower the floor its
 * reviewers must meet. No id means unverified (assumed premium).
 *
 * @param modelId - Model the executor ran, if known / 実行役のモデルID
 * @returns Executor reference (unverified when unknown) / 実行役（不明なら未確認）
 */
export function executorRefOf(modelId: string | null | undefined): ExecutorRef {
  if (!modelId?.trim()) return UNVERIFIED_EXECUTOR;
  const entry = findModelEntry(modelId);
  if (entry) {
    return { modelId: entry.modelId, vendor: entry.vendor, tier: entry.tier, verified: true };
  }
  const m = modelId.toLowerCase();
  const vendor: ModelVendor | null = /claude|opus|sonnet|haiku|fable|mythos/.test(m)
    ? 'anthropic'
    : /gpt|codex|^o\d\b/.test(m)
      ? 'openai'
      : /gemini/.test(m)
        ? 'google'
        : null;
  return { modelId, vendor, tier: observedTier(modelId), verified: true };
}
