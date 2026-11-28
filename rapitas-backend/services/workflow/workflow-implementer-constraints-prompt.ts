/**
 * Workflow Implementer Constraints Prompt
 *
 * The implementer's strict-constraints block (ja/en): code-only scope, the
 * self-verification API and how to wait for its verdict in the foreground.
 * Split out of workflow-role-prompts.ts (300-line threshold); does not build
 * the other roles' texts.
 */
import {
  verificationEvidencePrompt,
  shellExitCodeSafetyRule,
  implementerSelfCheckPrompt,
} from './workflow-verification-evidence-prompt';
import * as testScope from './workflow-test-scope-rule';
import { PRIMARY_CHECKOUT_GUIDANCE } from './primary-checkout-guidance';

// NOTE: Task 1582 — run 7975 started Monitor, wrote that it was waiting for the
// runId and ended its turn. rapitas runs the CLI as one `--print` turn, so the
// notification never arrived and the run was recorded as finished before the
// verdict. Background waiters are also denied at launch (claude-args.ts /
// claude-spawn-env.ts); this tells the agent what to do instead.
const FOREGROUND_WAIT_RULE_JA =
  '- **自己検証の結果は表で待つ（裏で待つことの禁止）**: Monitor・ScheduleWakeup・CronCreate・Bash の run_in_background・末尾の `&`・Start-Process で結果を裏で待たないでください。rapitas はエージェントを1回答えたら終わる形（`--print`）で動かしているため、裏で待っても知らせは届かず、番を終えた時点で実行は終わり扱いになります。`status` が `running` の間は番を終えないでください。待つときは「10秒の sleep と GET 1回」だけの短いコマンドを繰り返し（最大90回、合計900秒）、1つのコマンドで10秒より長く sleep しないでください。900秒を超えても `running` のままなら、検証を「未確定」と最終サマリに書いて番を終えてください。\n';

const FOREGROUND_WAIT_RULE_EN =
  '- **Wait for the self-verification verdict in the foreground (no background waiting)**: do not wait for the result with Monitor, ScheduleWakeup, CronCreate, Bash run_in_background, a trailing `&`, or Start-Process. rapitas runs the agent as a single answer (`--print`), so a background notification never reaches you and the run is recorded as finished the moment you end your turn — do not end your turn while `status` is `running`. Wait by repeating a short command that only sleeps 10 seconds and sends one GET (up to 90 times, 900 seconds total); never sleep longer than 10 seconds in one command. If it is still `running` after 900 seconds, record verification as unconfirmed in your final summary and end your turn.\n';

// NOTE: Task 1602 — each failing check in the self-verify response now carries
// the files, the real gate's message and a fix hint. Without this rule an
// implementer fixed the first item, re-ran, and handed over a partially red run.
const FAILED_CHECKS_RULE_JA =
  '- **落ちた検査をすべて直してから自己検証をやり直し、通ってから終える**: 自己検証の応答が `ok:false` なら、`checks` のうち `ok:false` の検査を、それぞれの `failureFiles`（対象のファイル）・`gateMessage`（本物のゲートでの扱い）・`fixHint`（直し方）を見て1つ残らず直してください。直したら POST から自己検証をやり直し、`ok:true` になってから終えてください。3回やり直しても通らない場合だけ、残った検査名と理由を最終サマリに書いて終えてください。\n';

const FAILED_CHECKS_RULE_EN =
  '- **fix every failed check before re-running self-verification, and finish only when it passes**: when the self-verify response is `ok:false`, fix every check in `checks` with `ok:false`, using its `failureFiles` (where), `gateMessage` (what the real gate reports) and `fixHint` (how to fix). Then re-run self-verification from the POST, and finish only once it returns `ok:true`. Only if it still fails after 3 re-runs, end with the remaining check names and why in your final summary.\n';

/**
 * Build the implementer constraints block for one task.
 *
 * @param taskId - Task id embedded into the self-verification URLs / タスクID
 * @param language - Output language / 出力言語
 * @returns Constraints text / 制約ブロックの本文
 */
export function buildImplementerConstraints(taskId: number, language: 'ja' | 'en'): string {
  if (language === 'ja') {
    return (
      '## 実装者の責務 (厳守)\n' +
      '- あなたの仕事はコード変更だけです。**verify.md / research.md / plan.md は絶対に保存しないでください。**\n' +
      '- `curl` / `Invoke-RestMethod` / `wget` によるワークフロー API の呼び出しは、下記の**自己検証 API**（と、ユーザー判断が必要な場合の question.md 保存）を除き禁じます。最終検証は次フェーズの verifier ロールが行います。\n' +
      '- 同様に `PUT /tasks/:id/status` などタスクステータスを変更する API も呼ばないでください。状態遷移は Rapitas 側が自動で行います。\n' +
      '- ワークフロー API の保存系を叩いても **400 で拒否されます** (status guard)。回避策の探索はせず、コード変更が終わったらそこで終了してください。\n' +
      `- **完了前の自己検証（必須・ジョブ起動＋GETポーリング）**: コード変更が完了したと判断したら、終了する前に \`curl -s --max-time 30 -X POST http://127.0.0.1:3001/workflow/tasks/${taskId}/run-verification\` を実行してください。このAPIは即座に \`{"runId":"...","status":"running","pollUrl":"..."}\` を返し、実際のlint/型/テストゲートはサーバー側で非同期に実行されます。\n` +
      '- **結果の取得（GETポーリング、POSTの再送は禁止）**: 応答の `pollUrl`（`GET http://127.0.0.1:3001<pollUrl>`）を、「10秒の sleep と GET 1回」だけを行う短いコマンドを繰り返して取得してください（最大90回、合計最大900秒）。`status:"completed"` になったら `ok`/`unverifiable`/`checks`/`markdown` を確認し、`"ok":false` なら内容を修正して再度POSTから実行（最大3回）。`status:"failed"` ならエラー内容を確認して修正してください。90回（900秒）経過しても `running` のまま、または `status:"interrupted"`（前回ジョブがサーバー再起動等で中断）の場合は、検証を「未確定」として最終サマリに記録し終了してください。**同一taskIdへ`run-verification`をPOSTで繰り返し送る行為・接続断のたびに新しい検証を起動する行為は禁止**です（実行中のジョブがあれば同じ `runId` を返すだけで新規ジョブは起動されません）。最初のPOSTの応答自体を受け取れなかった場合は `GET http://127.0.0.1:3001/workflow/tasks/${taskId}/run-verification/latest` で直近のジョブを取得してください（これも新規検証は起動しません）。検証状態を記録するためにローカルファイルを作る場合、`status` が `completed`/`failed`/`interrupted` のいずれかに確定するまではそのファイルを削除しないでください。最終サマリには使用した `runId` を必ず記載してください。\n'.replace(
        '${taskId}',
        String(taskId),
      ) +
      FOREGROUND_WAIT_RULE_JA +
      FAILED_CHECKS_RULE_JA +
      verificationEvidencePrompt('ja') +
      shellExitCodeSafetyRule('ja') +
      implementerSelfCheckPrompt('ja') +
      '- **受入基準の自己照合（完了宣言の条件）**: 自己検証の応答に `acceptance=NG` が含まれる場合、差分が受入基準に対応していない（または受入基準・タスク本文と無関係な差分である）可能性が高い。各受入基準に「この差分のどのファイル/変更が満たすか」を対応付けて確認し、対応付けられない基準が1つでも残る間は完了を宣言せず、差分を修正して自己検証を再実行してください。機械照合の誤検出（対応済みなのに NG）と判断した場合のみ、どの変更がどの基準を満たすかを最終サマリで明示した上で終了してよい。同様に `coverage=NG`（ソース変更にテスト非同伴）も、テストを追加してから完了してください。\n' +
      '- **plan.md チェックリストの全件照合（完了宣言の条件、差し戻し最多要因）**: plan.md がある場合、終了前にチェックリストの各項目（特に「テスト」「統合テスト」「〜のテストを追加」の項目）を1つずつ「実装済み / 未実施」で照合し、**未実施が1件でも残る間は終了しない**でください。検証者は未実施の計画項目が1件でも残れば `⚠️ 一部失敗` で差し戻します（2026-09-14〜20 の差し戻し 96 件の大半がこれです）。計画項目が不可能・不適切だと判断した場合は黙って省略せず、question.md で計画の改訂を求めてください。最終サマリに「plan チェックリスト照合: N/N 実装済み」の1行を必ず含めてください。\n' +
      '- 実装が完了したら、変更内容のサマリ (どのファイルを何のために変えたか) を最後のメッセージに残して終了してください。Rapitas が後段で verify.md を自動生成します。\n' +
      testScope.TEST_SCOPE_RULE_IMPLEMENTER_JA +
      '- **純粋関数・ユーティリティを単体で試したい場合、アドホックな検証スクリプトではなく既存/新規の `*.test.ts` を使ってください**: worktree内で `mkdir`/`cat > ...<<EOF` 等によるアドホックな検証スクリプトの作成や、それに伴うパッケージインストールの試行は禁止します。既存の `*.test.ts` に対象関数を直接importするテストが無いか確認し、無ければ最小限の `*.test.ts` を新規作成して `bun test --isolate <1ファイル>` で検証してください。\n' +
      PRIMARY_CHECKOUT_GUIDANCE.ja.trimEnd()
    );
  }
  return (
    '## Implementer Constraints (strict)\n' +
    '- Your job is code changes ONLY. **DO NOT save verify.md / research.md / plan.md.**\n' +
    '- Calling the workflow API via `curl` / `Invoke-RestMethod` / `wget` is forbidden except for the self-verification API below (and saving question.md when a user decision is required). Final verification is performed by the verifier role in the next phase.\n' +
    '- DO NOT call `PUT /tasks/:id/status` or any task-status mutation API. State transitions are managed by Rapitas.\n' +
    '- Save-type workflow API calls will return 400 if you try (status guard). Do not search for workarounds — finish when code changes are done.\n' +
    `- **Self-verification before finishing (REQUIRED — job launch + GET polling)**: once you judge the code changes complete, run \`curl -s --max-time 30 -X POST http://127.0.0.1:3001/workflow/tasks/${taskId}/run-verification\` before exiting. This API returns immediately with \`{"runId":"...","status":"running","pollUrl":"..."}\`; the actual lint/type/test gate runs asynchronously on the server.\n` +
    '- **Retrieving the result (GET polling — do NOT re-send the POST)**: poll the response\'s `pollUrl` (`GET http://127.0.0.1:3001<pollUrl>`) by repeating a short command that does only "sleep 10 seconds, then one GET" — up to 90 times (900 seconds total). Once `status:"completed"`, check `ok`/`unverifiable`/`checks`/`markdown`; if `"ok":false`, fix the issues and re-run from POST (up to 3 times). If `status:"failed"`, inspect the error and fix it. If it is still `running` after 90 polls (900 seconds), or `status:"interrupted"` (the previous job was interrupted by e.g. a server restart), record verification as unconfirmed in your final summary and exit. **Repeatedly POSTing `run-verification` for the same taskId, or starting a new verification on every disconnect, is FORBIDDEN** — a running job returns the SAME `runId` and no new job is started. If the initial POST response itself was never received, use `GET http://127.0.0.1:3001/workflow/tasks/${taskId}/run-verification/latest` to fetch the most recent job (this also never starts a new one). If you keep a local file to track verification state, do NOT delete it until `status` resolves to one of `completed`/`failed`/`interrupted`. Always record the `runId` you used in your final summary.\n'.replace(
      '${taskId}',
      String(taskId),
    ) +
    FOREGROUND_WAIT_RULE_EN +
    FAILED_CHECKS_RULE_EN +
    verificationEvidencePrompt('en') +
    shellExitCodeSafetyRule('en') +
    implementerSelfCheckPrompt('en') +
    '- **Reconcile every plan.md checklist item before finishing (the most common cause of repair bounces)**: when plan.md exists, go through each checklist item — especially test / integration-test / "add tests for …" items — and mark it done or not done. **Do not finish while any item is not done**: the verifier returns `⚠️ Partial` for a single unfinished plan item (most of the 96 bounces in the week to 2026-09-20). If an item is impossible or wrong, do not skip it silently — request a plan revision via question.md. End your final summary with one line: "plan checklist: N/N done".\n' +
    '- Once implementation is done, leave a short summary (which files changed and why) as your final message and exit. Rapitas auto-generates verify.md downstream.\n' +
    testScope.TEST_SCOPE_RULE_IMPLEMENTER_EN +
    '- **To try out a pure function or utility in isolation, use an existing or new `*.test.ts` file — never an ad-hoc script**: do not create ad-hoc verification scripts (`mkdir`/heredoc) or attempt package installs inside the worktree for this. Check whether an existing `*.test.ts` already imports the target function directly; if not, add a minimal `*.test.ts` and verify with `bun test --isolate <file>`.\n' +
    PRIMARY_CHECKOUT_GUIDANCE.en.trimEnd()
  );
}
