/**
 * ci-repair-guidance
 *
 * Fixed guidance text appended to the CI-repair feedback (verify.md block).
 * Not responsible for building the feedback itself (see ci-self-repair.ts).
 */

/**
 * Tells the ci_repair implementer where to reproduce CI and what never to touch.
 * NOTE: Added after task #907's ci_repair ran `git pull` + `db:prepare:sqlite` in the
 * primary checkout, killing the backend (task #996).
 */
export const CI_REPAIR_WORKTREE_GUIDANCE =
  '**CIの再現・修正は必ずこのタスクの worktree 内で行う。** primary checkout（メインのリポジトリ）へ `cd` したり、そこで `git pull` / `prisma` / `db:prepare` / `db:generate` を実行してはならない。backend プロセス（ポート3001）の停止・kill（Stop-Process / taskkill 等）も禁止。実行前フックが拒否し、インシデントとして記録される。';
