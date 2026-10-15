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
  {
    // ログ出力箇所: worktree-remove.ts:76 の logger.warn（removeWorktree内、
    // contentIsSafe が false の分岐）。`git status --porcelain` が非空で
    // recovery スナップショットも無い worktree の削除を拒否して作業を守った記録で、
    // 直後に `return false` するため削除・teardown・ブランチ削除には進まない
    // （:175/:212 でも再検査）。全呼び出し元が worktree-removal-backoff.ts の
    // 30分クールダウンを持つため再出力は有界（#1210、K-9669/K-12455）。
    // git失敗は別文言（Cannot prove work is preserved）、.gitメタデータ欠落は
    // 別文言（Missing Git metadata）で可視化され続ける。
    // NOTE: #1029 は本文言を「可視のまま」と固定していたが、同一シグネチャが
    // 再起票され続けたため、拒否側と同じ理由で抑制へ反転した。
    test: /^\[removeWorktree\] Preserving uncommitted work$/i,
    logger: /git-operations\/worktree-ops/i,
    because:
      '未コミット作業を持つworktreeの削除を拒否して作業を守った保護ガードの記録 — 削除は行われずデータは失われず、再出力は30分バックオフで有界。git失敗・メタデータ欠落は別シグネチャで可視化される',
  },
];
