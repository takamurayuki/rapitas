/**
 * route-shortfall
 *
 * Detects and records a SmartRouter decision that falls short of its
 * requirement — the tier floor, or the role's suitability in the model tier
 * table — because nothing that meets it is usable right now (追補5: 制約を満た
 * せない場合は、黙って基準を下げず表示と記録を残す). Not responsible for
 * choosing the model.
 */
import { createLogger } from '../../config/logger';
import { recordDecision } from '../observability/decision-trace';
import type { ModelTier } from './model-discovery';
import { isSuitableForRole, tierAtLeast } from './model-tier-table/tier-table';

const log = createLogger('smart-model-router');

/** What the route needed and what it got. */
export interface RouteShortfall {
  requiredTier: string;
  selectedTier: string;
  /** Human-readable explanation, appended to the route's reason. */
  reason: string;
}

/**
 * The tier a route must reach: the floor, unless the spend backstop set a
 * lower ceiling. That ceiling deliberately wins and is recorded on its own
 * (hardCapReason), so it is not a shortfall.
 *
 * @param opts.minTier - Role / risk / retry floor / 下限ティア
 * @param opts.hardCapTier - Spend backstop ceiling / 予算上限ティア
 * @returns The required tier, or undefined for no floor / 必要ティア
 */
export function requiredFloor(opts: {
  minTier?: ModelTier;
  hardCapTier?: ModelTier;
}): ModelTier | undefined {
  if (!opts.minTier) return undefined;
  if (opts.hardCapTier && !tierAtLeast(opts.hardCapTier, opts.minTier)) return opts.hardCapTier;
  return opts.minTier;
}

/**
 * Why the chosen model falls short of the route's requirement, if it does.
 *
 * @param args.requiredTier - Tier the route must reach / 必要ティア
 * @param args.selectedTier - Tier actually selected / 選ばれたティア
 * @param args.model - Model actually selected / 選ばれたモデル
 * @param args.role - Workflow role routed / ロール
 * @returns The shortfall, or undefined when the requirement is met / 未達内容
 */
export function detectShortfall(args: {
  requiredTier: ModelTier | undefined;
  selectedTier: string;
  model: string;
  role: string | undefined;
}): RouteShortfall | undefined {
  const selected = args.selectedTier as ModelTier;
  if (args.requiredTier && !tierAtLeast(selected, args.requiredTier)) {
    return {
      requiredTier: args.requiredTier,
      selectedTier: args.selectedTier,
      reason: `${args.requiredTier} 以上が必要だが、使えるモデルの最上位は ${args.selectedTier}`,
    };
  }
  if (args.role && !isSuitableForRole(args.model, args.role)) {
    return {
      requiredTier: args.requiredTier ?? args.selectedTier,
      selectedTier: args.selectedTier,
      reason: `ティア表で ${args.role} に置けるモデルが使えない（${args.model} を使用）`,
    };
  }
  return undefined;
}

/**
 * Log and record a shortfall in the decision trace. Fire-and-forget: the
 * record must never hold up or fail the route.
 *
 * @param args.taskId - Task routed / タスクID
 * @param args.role - Workflow role / ロール
 * @param args.model - Model used despite the gap / 使用モデル
 * @param args.shortfall - The gap / 未達内容
 * @param args.minTierReason - Why the floor was set / 下限の理由
 * @param args.excludedProviders - Providers excluded (cooldown etc.) / 除外プロバイダ
 */
export function recordShortfall(args: {
  taskId: number;
  role: string | undefined;
  model: string;
  shortfall: RouteShortfall;
  minTierReason?: string;
  excludedProviders: string[];
}): void {
  log.warn(
    { taskId: args.taskId, role: args.role, model: args.model, ...args.shortfall },
    '[SmartRouter] route below requirement',
  );
  void recordDecision({
    taskId: args.taskId,
    nodeKey: `task${args.taskId}:model-route-shortfall:${Date.now()}`,
    kind: 'param_select',
    summary: 'モデル選択の要件未達',
    input: {
      role: args.role ?? null,
      requiredTier: args.shortfall.requiredTier,
      selectedTier: args.shortfall.selectedTier,
      minTierReason: args.minTierReason ?? null,
      excludedProviders: args.excludedProviders,
    },
    candidates: [{ id: args.model, label: args.shortfall.selectedTier }],
    adoptedId: args.model,
    adoptedReason: args.shortfall.reason,
  }).catch(() => {});
}
