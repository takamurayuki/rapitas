/**
 * decision-trace/node-key
 *
 * Owns the `nodeKey` convention (`task658:model-route:<ts>`) — the only place
 * a decision's kind is recorded. Kept here rather than in the reading layer
 * because the writers form these keys, and one owner keeps the reader from
 * drifting away from what is actually written.
 */

/** Kind of decision, keyed by the nodeKey's middle segment. */
export type TraceKind =
  | 'model_tier'
  | 'workflow_mode'
  | 'risk_floor'
  | 'task_filing'
  | 'escalation'
  | 'plan_approval'
  | 'knowledge_use';

/** Segment → kind. Unlisted segments fall back to `model_tier` (historical rows). */
const KIND_BY_SEGMENT: Record<string, TraceKind> = {
  'model-route': 'model_tier',
  // A provider fallback re-picks the model after a cooldown, so it belongs with
  // the other model choices rather than in a category of its own.
  'provider-fallback': 'model_tier',
  'risk-floor': 'risk_floor',
  escalation: 'escalation',
  'task-filing': 'task_filing',
  'knowledge-recall': 'knowledge_use',
};

/**
 * Kinds whose outcome IS an execution outcome, and which the consistency
 * checker can therefore judge.
 *
 * The rest are decisions about whether work was worth doing or whether recalled
 * knowledge helped — questions an execution's exit status cannot answer. Judging
 * them by it would repeat, in a new place, the error of blaming a decision for
 * an outcome that was never its to own.
 */
const EXECUTION_BACKED: ReadonlySet<TraceKind> = new Set<TraceKind>([
  'model_tier',
  'risk_floor',
  'escalation',
]);

/**
 * Read the decision kind out of a nodeKey.
 *
 * @param nodeKey - e.g. "task658:model-route:1787672867337". / ノードキー
 * @returns The kind, defaulting to model_tier for rows that predate any other. / 種別
 */
export function kindFromNodeKey(nodeKey: string | null | undefined): TraceKind {
  // A malformed key must not take a whole batch down with it; the default is
  // the kind every historical row actually is.
  if (typeof nodeKey !== 'string') return 'model_tier';
  const segment = nodeKey.split(':')[1] ?? '';
  return KIND_BY_SEGMENT[segment] ?? 'model_tier';
}

/**
 * Whether this decision's verdict can be read off its execution.
 *
 * @param nodeKey - The decision's nodeKey. / ノードキー
 * @returns True when the consistency checker owns the verdict. / 整合性チェッカーが判定を持つ場合 true
 */
export function isExecutionBacked(nodeKey: string | null | undefined): boolean {
  return EXECUTION_BACKED.has(kindFromNodeKey(nodeKey));
}
