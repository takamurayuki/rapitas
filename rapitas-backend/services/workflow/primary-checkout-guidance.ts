/**
 * primary-checkout-guidance
 *
 * Shared prompt text telling workflow agents never to touch the primary checkout,
 * including read-only-looking `git -C <primary>` calls. Not responsible for the
 * pre-execution hook itself (scripts/primary-guard-hook.cjs).
 */

/**
 * Guidance appended to implementer / verifier prompts.
 * NOTE: The hook rejects `git -C <primary> branch ...` as primary_mutation (tasks 1055/1103/1104),
 * so the primary path is intentionally written as an abstract `<primary>` placeholder here.
 */
export const PRIMARY_CHECKOUT_GUIDANCE = {
  ja: '- **primary checkout には一切触れない（読み取りに見える操作も禁止）**: 現在ブランチ・状態・履歴の確認は、cwd（この worktree）で直接 `git branch --show-current` / `git status` / `git log` を実行してください。`git -C <primary> ...` や `cd <primary>` は禁止で、実行前フックが拒否しインシデント起票されます（`git -C <この worktree>` は問題ありません）。他ブランチの調査・比較は worktree 内から `origin/<branch>` を直接指定すれば足ります（`origin/*` の ref は共有済み）。\n',
  en: '- **Never touch the primary checkout (even with read-only-looking commands)**: check the current branch / status / history by running `git branch --show-current` / `git status` / `git log` directly in your cwd (this worktree). `git -C <primary> ...` and `cd <primary>` are forbidden — the pre-execution hook rejects them and files an incident (`git -C <this worktree>` is fine). To inspect or compare other branches, pass `origin/<branch>` from inside the worktree (`origin/*` refs are shared).\n',
} as const;
