/**
 * model-attribution
 *
 * Decides which model a CLI execution should be RECORDED against, given the
 * per-model usage breakdown reported by the stream-json `result` event.
 * Attribution only — it never touches routing or cost totals.
 */

/**
 * Choose the model that actually did the work in a `modelUsage` map.
 *
 * Ranks by the per-model cost the CLI reports, falling back to TOTAL tokens
 * (cache reads and cache writes included) when no model reports a cost.
 *
 * NOTE: The previous ranking summed only `inputTokens + outputTokens`. In an
 * agentic CLI session the main model's input is ~99% cache-READ, so its
 * uncached input is near zero, while Claude Code's small background model
 * (haiku: bash-command descriptions, conversation titles, file summaries)
 * bills its short prompts as fresh input. That let the side model outrank the
 * main one: measured 2026-08-23, the router picked haiku for 4 of 311 routing
 * decisions but 244 executions were RECORDED as haiku. The attribution feeds
 * role-evidence.ts (evidence-based tier routing) and every cost report, so a
 * mislabelled row is not cosmetic — it teaches the router the wrong lesson.
 *
 * @param modelUsage - Per-model usage block from the stream-json result event. / モデル別使用量
 * @returns The dominant model id, or undefined when the map is empty. / 主モデルID
 */
export function pickPrimaryModel(
  modelUsage:
    | Record<
        string,
        {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
          costUsd?: number;
        }
      >
    | undefined,
): string | undefined {
  if (!modelUsage) return undefined;
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return undefined;

  const weigh = (u: (typeof entries)[number][1], byCost: boolean): number =>
    byCost
      ? (u.costUsd ?? 0)
      : (u.inputTokens ?? 0) +
        (u.outputTokens ?? 0) +
        (u.cacheReadInputTokens ?? 0) +
        (u.cacheCreationInputTokens ?? 0);

  // Cost is the truest "who did the work" signal, but older CLI builds omit
  // per-model cost — fall back to cache-inclusive tokens rather than to the
  // uncached-only sum that caused the misattribution.
  const byCost = entries.some(([, u]) => (u.costUsd ?? 0) > 0);

  let best: { name: string; weight: number } | null = null;
  for (const [name, u] of entries) {
    const weight = weigh(u, byCost);
    // Name comparison breaks ties deterministically so an equal-weight map
    // cannot make the recorded model depend on object key ordering.
    if (!best || weight > best.weight || (weight === best.weight && name < best.name)) {
      best = { name, weight };
    }
  }
  return best?.name;
}
