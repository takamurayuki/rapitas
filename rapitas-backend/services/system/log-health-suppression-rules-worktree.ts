/**
 * log-health-suppression-rules-worktree
 *
 * Suppression rules for worktree-removal guard logs. Split from
 * log-health-suppression-rules.ts, which sits at the line-count ratchet.
 */
import type { Suppression } from './log-health-suppressions-types';

/** Worktree-removal guard lines that report a protection, not a defect. */
export const WORKTREE_SUPPRESSIONS: Suppression[] = [
  {
    // ログ出力箇所: worktree-remove.ts:266-268 の logger.warn（removeWorktree内、
    // ブランチ削除の分岐）。`git rev-list --not --remotes` で未pushコミットを持つ
    // ブランチは forceRemove でない限り `git branch -D` せず保全する、task 536
    // （未pushコミット消失事故）の再発防止ガード。worktree除去は完了済みで
    // ブランチが残るだけ（#1142、K-11878/K-11580）。ブランチ削除失敗は別文言
    // （Failed to delete branch）で可視化され続ける。
    test: /\[removeWorktree\] KEEPING unmerged branch .* # commit\(s\) exist on no remote/i,
    logger: /git-operations\/worktree-ops/i,
    because:
      '未pushコミットを持つブランチの削除を見送る保護ガードの記録 — worktreeは除去済みでブランチが残るだけでデータは失われず、ブランチ削除の失敗は別シグネチャで可視化される',
  },
];
