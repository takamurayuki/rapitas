/**
 * AutoMergeDraftPromotion
 *
 * Decides whether a draft pull request has earned promotion to ready.
 * Not responsible for performing the promotion or for merging — the watcher
 * owns both, so this decision stays pure and testable.
 */

/** What the watcher knows about a PR at the point it would otherwise hold it. */
export interface DraftPromotionInput {
  /** `readIsDraft` result; null means the state could not be read. */
  draft: boolean | null;
  /**
   * True only when BLOCKING CI checks actually ran and passed — not when the
   * watcher upgraded `unknown` to `pass` through GitHub's CLEAN merge state
   * because nothing blocking ran at all.
   */
  ciVerified: boolean;
}

/**
 * Whether to promote a draft PR to ready.
 *
 * NOTE: Task 1099 opens a draft whenever the local verification gate returns
 * `unknown`, and the watcher then holds drafts forever — `readyPullRequest` is
 * called from one place only, at publication time, and only for a verdict that
 * was already `pass`. Nothing promoted a draft whose CI went green afterwards,
 * so every such PR was a dead end. Measured 2026-10-11: temporaid's env-setup
 * PR #1 was opened draft because e2e cannot run on this host, its CI passed on
 * the runner, and it still had to be promoted by hand.
 *
 * Green CI is precisely the verification the local gate could not produce, so
 * it is the right trigger. Two cases deliberately do NOT promote: a `pass` that
 * came from the no-CI fallback (nothing was verified, so the draft's reason
 * stands), and an unreadable draft state (the watcher treats null as draft, and
 * promoting on a guess would break that fail-closed rule).
 *
 * @param input - Draft state and whether CI genuinely verified the head / draft 状態と CI の実証有無
 * @returns Whether the PR should be marked ready / ready に昇格すべきか
 */
export function shouldPromoteDraftToReady(input: DraftPromotionInput): boolean {
  return input.draft === true && input.ciVerified;
}

/** What `resolveDraftHold` needs to act and to log. */
export interface DraftHoldContext extends DraftPromotionInput {
  cwd: string;
  prNumber: number;
  taskId: number;
  /** Marks the PR ready; returns whether GitHub accepted it. */
  markReady: (cwd: string, prNumber: number) => Promise<boolean>;
  log: { info: (fields: Record<string, unknown>, msg: string) => void };
}

/**
 * Handle a PR the watcher is about to hold for being a draft: promote it when
 * CI has earned it, and report whether the hold still stands.
 *
 * Lives here rather than inline in the watcher because that file is at its
 * 500-line hard limit; keeping the side effect next to the decision it depends
 * on also means one call site instead of a branch the watcher has to re-explain.
 *
 * @param ctx - PR identity, draft/CI state, and the collaborators / PR情報と協調相手
 * @returns true when the PR must still be held this tick / 今回も保留すべきなら true
 */
export async function resolveDraftHold(ctx: DraftHoldContext): Promise<boolean> {
  if (!shouldPromoteDraftToReady(ctx)) {
    ctx.log.info(
      { taskId: ctx.taskId, prNumber: ctx.prNumber, draft: ctx.draft, ciVerified: ctx.ciVerified },
      '[auto-merge] PR is draft (or draft state unknown) — holding, not merging/completing',
    );
    return true;
  }
  const promoted = await ctx.markReady(ctx.cwd, ctx.prNumber);
  ctx.log.info(
    { taskId: ctx.taskId, prNumber: ctx.prNumber, promoted },
    promoted
      ? '[auto-merge] Draft PR promoted to ready — CI verified what the local gate could not; merging on the next tick'
      : '[auto-merge] Draft PR promotion failed — still holding',
  );
  // Held either way this tick: a freshly promoted PR merges on the next pass,
  // which keeps promotion and merge as separate, individually observable steps.
  return true;
}
