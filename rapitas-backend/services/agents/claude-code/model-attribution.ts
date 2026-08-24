/**
 * model-attribution
 *
 * Decides which model a CLI execution should be RECORDED against, given the
 * per-model usage breakdown reported by the stream-json `result` event.
 * Attribution only — it never touches routing or cost totals.
 */

/**
 * Choose the model an execution should be RECORDED against.
 *
 * The instructed model (what the router told the CLI to run via `--model`)
 * is ground truth when the CLI's own usage breakdown corroborates it —
 * i.e. it appears as a key in `modelUsage` at all, regardless of its cost
 * share. Only when the instructed model is absent (older CLI builds, or a
 * session that never reports it) does this fall back to ranking by cost.
 *
 * NOTE: The previous ranking summed only `inputTokens + outputTokens`. In an
 * agentic CLI session the main model's input is ~99% cache-READ, so its
 * uncached input is near zero, while Claude Code's small background model
 * (haiku: bash-command descriptions, conversation titles, file summaries)
 * bills its short prompts as fresh input. That let the side model outrank the
 * main one: measured 2026-08-23, the router picked haiku for 4 of 311 routing
 * decisions but 244 executions were RECORDED as haiku. Ranking by cost alone
 * still had the same failure mode one level up: measured 2026-08-24 (task
 * 627, execution 2749), the router instructed claude-sonnet-5 but the CLI's
 * per-model cost breakdown recorded claude-opus-4-8 (a session-internal
 * auxiliary call) as the highest earner, so the execution was mislabelled
 * opus even though sonnet did the actual work. The attribution feeds
 * role-evidence.ts (evidence-based tier routing) and every cost report, so a
 * mislabelled row is not cosmetic — it teaches the router the wrong lesson.
 *
 * @param modelUsage - Per-model usage block from the stream-json result event. / モデル別使用量
 * @param instructedModel - The model id the router told the CLI to run (`--model`). Preferred when present in `modelUsage`. / 指示したモデルID
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
  instructedModel?: string,
): string | undefined {
  if (!modelUsage) return undefined;
  const entries = Object.entries(modelUsage);
  if (entries.length === 0) return undefined;

  if (instructedModel && instructedModel in modelUsage) {
    return instructedModel;
  }

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
