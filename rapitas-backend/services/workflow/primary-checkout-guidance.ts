/**
 * primary-checkout-guidance
 *
 * Shared prompt text telling workflow agents never to touch the primary checkout,
 * including read-only-looking `git -C <primary>` calls. Not responsible for the
 * pre-execution hook itself (scripts/primary-guard-hook.cjs).
 */

/**
 * Guidance appended to every role prompt.
 * NOTE: The hook rejects `git -C <primary> branch ...` as primary_mutation (tasks 1055/1103/1104),
 * so the primary path is intentionally written as an abstract `<primary>` placeholder here.
 * NOTE: Also carries the process-lifecycle rule (never terminate processes you started; record them
 * in the final report) because this constant already reaches all four roles in ja/en (task 1171).
 */
export const PRIMARY_CHECKOUT_GUIDANCE = {
  ja: '- **primary checkout には一切触れない（読み取りに見える操作も禁止）**: cwd は既にこの task 専用 worktree です。primary の絶対パスへ `cd` せず、ファイル検索・grep も cwd からの相対パスで行ってください（`cd` で位置を確かめる必要はありません）。現在ブランチ・状態・履歴の確認は、cwd（この worktree）で直接 `git branch --show-current` / `git status` / `git log` を実行してください。`git -C <primary> ...` や `cd <primary>` は禁止で、実行前フックが拒否しインシデント起票されます（`git -C <この worktree>` は問題ありません）。位置が不確かでも「`cd <primary> 2>/dev/null; cd <worktree>` のように primary を先に試し、失敗時に worktree へ落とす」連鎖は禁止です（先頭の `cd <primary>` の時点で拒否されます）。`cd` せず cwd のまま相対パスで実行してください。他ブランチの調査・比較は worktree 内から `origin/<branch>` を直接指定すれば足ります（`origin/*` の ref は共有済み）。**起動したプロセスは自力で終了させず**（kill / Stop-Process / taskkill は拒否されます）、PID・コマンド・起動理由を最終報告（verify に反映される）に記録してください。未マージの他タスクの実装を読みたい場合も、`.worktrees` や兄弟 worktree へ `cd` せず、`git show origin/<branch>:<path>` / `git grep <pattern> origin/<branch>` を使ってください（ref が無ければ worktree 内で `git fetch origin <branch>`）。\n',
  en: '- **Never touch the primary checkout (even with read-only-looking commands)**: your cwd is already the task-specific worktree. Never `cd` to an absolute primary path; search and grep with paths relative to your cwd (no need to `cd` to find your way). Check the current branch / status / history by running `git branch --show-current` / `git status` / `git log` directly in your cwd (this worktree). `git -C <primary> ...` and `cd <primary>` are forbidden — the pre-execution hook rejects them and files an incident (`git -C <this worktree>` is fine). Even when unsure of your location, never chain `cd <primary> 2>/dev/null; cd <worktree>` — a command that tries the primary first and falls back to your worktree on failure is rejected at the first `cd <primary>`. Do not `cd` at all; run from your cwd with relative paths. To inspect or compare other branches, pass `origin/<branch>` from inside the worktree (`origin/*` refs are shared). Do not terminate a process you started yourself (kill / Stop-Process / taskkill are rejected); record its PID, command, and start reason in your final report (reflected into verify). To read unmerged work of another task, likewise never `cd` into `.worktrees` or a sibling worktree; use `git show origin/<branch>:<path>` / `git grep <pattern> origin/<branch>` (run `git fetch origin <branch>` in your worktree if the ref is missing).\n',
} as const;
