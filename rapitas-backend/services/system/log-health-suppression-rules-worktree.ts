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
  {
    // ログ出力箇所: plan-auto-approve.ts:201-204 の logger.warn（maybeAutoApprovePlan内、
    // resolveForbiddenChangePlanHold が非nullの分岐）。計画がスキーマ等の人間overrideが
    // 必要なファイルを宣言した場合に自動承認を見送る設計どおりの保護ガード。直前に
    // recordTransition(cause=plan_forbidden_change_hold) で遷移がDBに残り、初回のみ
    // notifyPlanHold で通知される。24h超の保留は plan-hold-exclusion.ts の停滞検知が再開する（#1296）。
    // NOTE: 兄弟ログ（[forbidden-change-plan-hold]）は別ロガー・別文言のため本ルールの対象外。
    test: /^\[plan-auto-approve\] auto-approval withheld — plan needs a human forbidden-change override$/i,
    logger: /^plan-auto-approve$/i,
    because:
      '人間のoverrideが必要な計画を自動承認しなかった設計どおりの保護ガードの記録 — 保留は遷移として記録され初回に通知もされ、24h超は停滞検知が再開する。他の plan-auto-approve の警告は別シグネチャで可視化される',
  },
];
