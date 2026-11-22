/**
 * live-process-guidance
 *
 * Prompt text telling planner, implementer and verifier to confirm that an
 * app starts through the runtime check, and to stop anything they start by
 * hand before their phase ends. Not responsible for the stopping itself —
 * agent-reap.ts sweeps leftovers in the task worktree as a safety net.
 *
 * NOTE: Trendline task 1520's plans had the verifier run start.bat / start.sh
 * by hand. It could not stop what it started, the stack kept port 8090, and
 * each following verification failed with "port in use" (2026-11-22). The
 * runtime check (POST /workflow/tasks/:id/run-verification) already starts the
 * app, checks its health and stops it under recorded process ownership.
 */

/** Phases that get the guidance. */
export type LiveProcessRole = 'planner' | 'implementer' | 'verifier';

const COMMON_JA = `- アプリが起動することの確認は、自己検証 API（\`POST /workflow/tasks/{taskId}/run-verification\`）の runtime 結果を使う。runtime はテーマの起動設定でアプリを起動し、応答を確かめ、所有を記録したうえで止める。
- 開発サーバーや起動スクリプト（start.bat、start.sh、npm run dev など）を自分で起動した場合は、**この工程を終える前に**プロジェクトの停止手段（stop スクリプトや起動したシェルの終了）で止め、ポートが空いたことを確かめて記録する。止めずに残すと、次の検証がポート使用中で失敗する。`;

const COMMON_EN = `- Confirm that the app starts through the self-verification API's runtime result (\`POST /workflow/tasks/{taskId}/run-verification\`). The runtime check starts the app from the theme's start config, checks it answers, and stops it under recorded ownership.
- If you start a dev server or start script yourself (start.bat, start.sh, npm run dev, …), **stop it before this phase ends** with the project's own stop command (a stop script, or ending the shell that started it), check that its ports are free, and record that. A process left running makes the next verification fail with "port in use".`;

const PLANNER_EXTRA_JA = `- 計画で実機の起動確認を求める場合は、まず runtime 結果で足りるかを考える。起動スクリプトそのものを動かす必要があるときは、**起動のあとの停止の手順**（使うコマンドと、ポートが空いたことの確認）も同じ計画に書く。止める手段が無い起動を検証者に求めない。`;
const PLANNER_EXTRA_EN = `- When the plan asks for a live start, first consider whether the runtime result is enough. If a start script itself must run, write the **stop step** after it in the same plan (the command, and checking the ports are free). Never ask the verifier to start something it has no way to stop.`;

/**
 * Guidance for one phase.
 *
 * @param role - Phase the prompt is for / 対象のフェーズ
 * @param language - Prompt language / プロンプトの言語
 * @returns Section text / 指示の節
 */
export function liveProcessGuidance(role: LiveProcessRole, language: string): string {
  const en = language === 'en';
  const heading = en ? '## 起動の確認 (confirming a start)' : '## 起動の確認';
  const extra = role === 'planner' ? `\n${en ? PLANNER_EXTRA_EN : PLANNER_EXTRA_JA}` : '';
  return `${heading}\n${en ? COMMON_EN : COMMON_JA}${extra}`;
}
