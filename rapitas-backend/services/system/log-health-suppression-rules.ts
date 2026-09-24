/**
 * log-health-suppression-rules
 *
 * The suppression rule table used by log-health-suppressions.ts's
 * classifyLogSignature(). Split out (task 1040) so the parent file stays
 * under the COMPONENT_SPLITTING_POLICY line-count ratchet — this file holds
 * only data, classifyLogSignature() and its types stay in the parent.
 */
import type { Suppression } from './log-health-suppressions-types';

/**
 * Lines that report a guard, a recovery, or an expected condition.
 *
 * Each entry names why nothing is left broken. A rule that cannot state that
 * does not belong here — the fallback is to file the concern, because a missed
 * suppression costs one noisy row while a wrong one hides a real defect.
 */
export const SUPPRESSIONS: Suppression[] = [
  {
    test: /Refusing to (switch|create|commit|delete|reset)/i,
    because: 'ガードが危険な操作を拒否した — 防いだ側であり、壊れていない',
  },
  {
    test: /primary working tree — skipping|to protect \w+/i,
    because: 'プライマリ保護ガードが働いた',
  },
  {
    // workflow-reconciler-queue-stall.ts の detectQueueStarvation が出す対の
    // ログ。「restarted」側は既にここで抑制済みだったが、runner が既に処理中で
    // kick が no-op になるケースの文言(同ファイル130-147行、"a kick cannot help;
    // not restarting")は別文言のため未マッチだった。#761/#730と同型の抑制網の
    // 対象漏れ — 実際に何かが壊れているわけではなく、runner稼働中の待機を記録
    // しているだけ(#781)。
    test: /Queue starvation detected — restarted|re-enqueued to resume|was already queued; tracking|kick cannot help; not restarting/i,
    because:
      '自己修復が成功している、または runner 稼働中の待機を記録しているだけ — 検出して回復/継続した記録',
  },
  {
    test: /Working tree dirty (at boundary )?— (skipping|restart skipped)/i,
    because: '安全条件が揃わないため再起動を見送った — 意図した挙動',
  },
  {
    test: /auto-run dry \+ new commits.*restarting to apply updates/i,
    because: '設定どおりの計画的な再起動',
  },
  {
    test: /Already running/i,
    logger: /workflow-runner/i,
    because: '多重起動を防ぐ通常の状態報告',
  },
  {
    test: /Ollama probe failed|Unable to connect.*ollama/i,
    because: '任意プロバイダが不在なだけ — 必須ではない',
  },
  {
    // #760: 実際の呼び出し箇所の大半は "failing open"(ハイフン無し動詞句)を使っており
    // "fail-open"(ハイフン付き名詞句)のみにマッチする旧正規表現では拾えなかった。
    // 例: critic-gate.ts:90, completion-gate.ts:110, verify-self-repair.ts:185 ほか。
    test: /fail(?:ing)?-open|failing open|skipping \(fail-open\)/i,
    because: '明示的に fail-open として継続している',
  },
  {
    test: /Worker process exited/i,
    logger: /agent-worker-manager/i,
    because: 'シャットダウン時の通常終了 — クラッシュは別シグネチャで記録される',
  },
  {
    test: /self-repair|re-running implement→verify/i,
    because: '差し戻しループは専用の収束検出が担当する — ログ経由の二重起票',
  },
  {
    test: /shutting down, cannot start|interrupted by shutdown/i,
    because: '停止処理中の想定内メッセージ — 再起動後に解消する',
  },
  {
    test: /verify\.md (failed validation|self-contradicts)/i,
    because: '検証ゲートが不正な成果物を捕捉した — ゲートが働いた側',
  },
  {
    test: /no commits between/i,
    logger: /github-service:client/i,
    exclude: /base (?:sha|ref)|sha can't be blank|must be a branch/i,
    because:
      'gh pr create 対象ブランチに差分がない — isNoChangeCompletion が安全な無差分完了として扱う想定内の失敗',
  },
  {
    // blockTaskForVerification（agents:verification-gate）と performAutoCommitAndPR
    // （routes:workflow:auto-commit, workflow-auto-commit.ts:200-203）は同一の検証
    // ゲート失敗イベントに対してそれぞれ独自のERRORログを出す。止めた側であって、
    // 壊れた側ではない。実測 2026-08-27: 前者がタスク685として起票され、直すべき
    // バグが無いため、エージェントは「ERRORログを減らす」を出力抑制で達成しようとした。
    // 存在しない欠陥を指示すると、症状を消す方向に流れる。実測 2026-08-29: 後者側の
    // 文言が抑制対象外だったため、同じ検証ゲート失敗イベントがタスク730として再度
    // 起票された（K-6442/K-7506）。実測 2026-09-21: performAutoCommitAndPR の実際の
    // 文言は "holding the local commit, no push/PR"（workflow-auto-commit.ts:272）
    // であり aborting auto-commit/PR ではなかったため、K-9885/K-10638/K-11229 として
    // 三度目の再起票が発生した（タスク1043）。三つの文言をここで吸収する。
    test: /Automated verification failed — (blocking|aborting auto-commit\/PR|holding the local commit, no push\/PR)/i,
    because: '検証ゲートが基準未達を捕捉してタスク/auto-commitを止めた — ゲートが働いた側',
  },
  {
    // ログ出力箇所: workflow-auto-commit-publish-guard.ts:114 の
    // syncAndReverifyBeforePublish。baseSync.status が conflict_unresolved
    // （aux AIがbase取り込みのマージ競合を自動解消できなかった）または
    // reverify_failed（base取り込み後の再検証＝lint/型/テストに失敗した）の
    // いずれかでのみ発火する。PRを安全側で止めるガード判定であり、worktreeは
    // 削除せず保持し、notify()でbase_sync_conflict_unresolved/
    // base_sync_reverify_failed通知を送出して手動確認・再実行の導線を残す
    // （同ファイル90-115行）。分岐は
    // workflow-auto-commit-publish-guard.test.ts:129-141 でテスト済み（タスク1048）。
    test: /pre-PR base sync blocked PR creation/i,
    logger: /routes:workflow:auto-commit:publish-guard/i,
    because:
      'base取り込みの競合/再検証失敗をガードが検知してPR作成を止めた — worktree保持+通知済みで後続の手動対応導線あり、ゲートが働いた側',
  },
  {
    // 実行の結末を記録する行。原因は当の実行自身のログに出ているので、
    // ここから起票すると同じ事象が二重に上がる。
    test: /Execution ended with status: failed/i,
    because: '実行結果の記録 — 原因は当該実行のログ側に出ており、二重起票になる',
  },
  {
    // ログ出力箇所: execution-file-logger/index.ts:234-249 の logExecutionEnd。
    // NOTE: #694 以降 err.message が msg に優先採用される（log-format-parser.ts:82）ため、
    // 正規化後は "Process exited with code # …" となり、上の Execution ended with status:
    // failed ルールに届かない。本文は execution-resolver.ts:238-267 が組み立てる。
    test: /^Process exited with code #/i,
    logger: /execution-file-logger/i,
    because:
      '実行が failed で終わった結末の記録 — 原因は当該実行のログ側に出ており、二重起票になる（失敗自体はDBの実行ステータス・fallback・stall監視で検知される）',
  },
  {
    // ログ出力箇所: claude-code/execution-resolver.ts:204-208 の logger.error。
    // CLI が exit 非 0 かつ prompt-too-long を報告した時のみ発火し（議論文言による
    // 誤検知は ac8ae459 の exit code ゲートで解消済み）、直後に failureType
    // 'prompt_too_long' + PROMPT_TOO_LONG_MARKER で fail-fast 解決される。当該セッションは
    // 再開対象から除外される（failure-reason-markers.ts）ため、ガードが働いた記録である（#1036）。
    test: /Prompt\/context too long — failing fast/i,
    logger: /claude-code-agent/i,
    because:
      'prompt-too-long を検知して fail-fast し、セッションを再開対象から除外したガードの記録 — 失敗自体は実行結果側(failureType: prompt_too_long)に残り、二重起票になる',
  },
  {
    // ログ出力箇所: execution-file-logger/index.ts:234-249 の logExecutionEnd。本文は
    // execution-resolver.ts:217 が入力長超過検出時（failureType: 'prompt_too_long'）に
    // 組み立てる。NOTE: err.message が msg に優先採用されるため正規化後は
    // "【Prompt Too Long】…" となり、上の Process exited ルールに届かない。
    test: /^【Prompt Too Long】/,
    logger: /execution-file-logger/i,
    because:
      '入力長超過で failed になった結末の記録 — 対処は実装済み（execution-resume.ts:175 / phase-session-resume.ts:203 が --resume せずコールドスタート、fallback-decision.ts:52 が無駄なフォールバックを回避）で、失敗自体はDBの実行ステータス・stall監視で検知される',
  },
  {
    // ログ出力箇所: fallback-decision.ts:50-58 の logger.warn（checkNeedsFallback
    // 内）。成功扱いの出力からプロバイダ障害の兆候を classifyAgentError が検知し、
    // フォールバックへ切り替えると判定した時点の告知ログ — 検出ロジック自体は意図した
    // 分類であり、欠陥ではない。同一イベントは services/ai/recovery-metrics/ が既に
    // taskId・phase・fromProvider・strategy・outcome 付きで構造化記録しており、ログ
    // 経由の起票は重複になる。フォールバックが最終的に失敗した場合は別シグネチャ
    // （下記の Execution ended with status: failed）で捕捉されるため、本ルールで
    // 最終失敗の可視性が失われることはない（#782）。
    test: /Detected provider error in successful output — forcing fallback/i,
    logger: /task-executor/i,
    because:
      '成功出力からプロバイダ障害の兆候を検知しフォールバックへ切り替えた告知ログ — 検出は意図した分類ロジックであり、同一イベントはrecovery-metricsが既に構造化記録している',
  },
  {
    // ログ出力箇所: fallback-executor.ts:113-123 の logger.warn。checkNeedsFallback
    // （fallback-decision.ts:22-53）がプロバイダ障害を検知し、代替エージェント設定で
    // 再試行を開始する時点の告知ログ — 障害の検出自体は意図した分類ロジックであり、
    // 欠陥ではない。同一イベントは services/ai/recovery-metrics/ が既に
    // taskId・phase・fromProvider・strategy・outcome 付きで構造化記録しており、
    // ログ経由の起票は重複になる。フォールバックが最終的に失敗した場合は別シグネチャ
    // （上記の Execution ended with status: failed）で捕捉されるため、本ルールで
    // 最終失敗の可視性が失われることはない（#758）。
    test: /Provider failed — retrying with alternative agent config/i,
    logger: /task-executor/i,
    because:
      'フォールバック機構が代替エージェントで再試行を開始した告知ログ — 障害検出は意図した分類ロジックであり、同一イベントはrecovery-metricsが既に構造化記録している',
  },
  {
    // ログ出力箇所: task_queue.ts:230-233 の log.warn（reapStuckProcessing内）。
    // attempts < maxAttempts の行を pending に差し戻し、次回ポーリングで自動リトライ
    // させる自己修復の成功記録であり、壊れた側ではない（#761）。maxAttempts到達で
    // dead_letter に送られる場合は別シグネチャ（'Stuck processing task moved to
    // dead_letter'、ERROR）で記録されるため、本ルールで恒久失敗の可視性は失われない。
    test: /Stuck processing task requeued as pending/i,
    logger: /memory:task-queue/i,
    because:
      'reapStuckProcessing の自己修復が成功した記録 — 次回ポーリングで自動リトライされ、maxAttempts到達時は別シグネチャ(dead_letter)で記録される',
  },
  {
    // ログ出力箇所: middleware/error-handler.ts:165-170 の `code === 'PARSE'` 分岐
    // （#683 で追加）。JSONパース失敗はここで log.warn（ERRORではなくWARN）+ status 400
    // として処理される。ParseError の message は elysia 側で "Bad Request" 固定
    // (node_modules/elysia/dist/error.mjs:35-43, `class ParseError extends Error`)であり、
    // この分岐が汎用フォールバック(同ファイル182行目, log.error 'Unhandled error')より
    // 先に評価されるため、「Bad Request: Failed to parse JSON」がERRORとして起票される
    // 経路は現行コードに存在しない。#683 適用前の生成物が今回起票されたものと判定。
    test: /Bad Request: Failed to parse JSON/i,
    logger: /error-handler/i,
    because:
      'middleware/error-handler.ts:165-170 のPARSE分岐(#683)がlog.warn+400で処理しており、ERRORとして起票される経路は存在しない',
  },
  {
    // ログ出力箇所: middleware/error-handler.ts:165-170 の `code === 'PARSE'` 分岐
    // （#683）が出す WARN メッセージそのもの（上のERROR版ルールは#683適用前の旧文言用）。
    // 不正なJSONボディを400として正しく拒否した記録であり、サーバー側の欠陥ではない
    // （タスク#861で確認、tests/middleware/error-handler.test.ts:326-341 で担保）。
    test: /Failed to parse JSON request body/i,
    logger: /error-handler/i,
    because:
      'middleware/error-handler.ts:165-170 のPARSE分岐(#683)がクライアントの不正JSONボディを400で正しく拒否した記録 — サーバー側の欠陥ではない',
  },
  {
    // ログ出力箇所: services/ai/provider-cooldown.ts:149 の markProviderCooldown()。
    // 呼び出し元(agent-fallback.ts, workflow-provider-fallback.ts,
    // gemini-cli-agent/stream-handler.ts)はquota/rate_limit/auth/transient
    // エラー検知時にプロバイダを一時停止し代替へフォールバックする、意図した挙動を記録する。
    test: /Provider placed in cooldown/i,
    logger: /ai:provider-cooldown/i,
    because:
      'フォールバック機構がquota/rate_limit等を検知しプロバイダを一時停止した記録 — 代替プロバイダへの自動切替が正常に働いた側',
  },
  {
    // ログ出力箇所: services/agents/claude-code/cli-utils.ts:65 の resolveCliPath()。
    // `where` による事前解決が失敗しても、呼び出し元は buildSpawnCommand で
    // spawn(..., { shell: true }) を使うため cmd.exe が実行時にPATHを再解決し、
    // CLI実行自体には影響しない（cli-utils.ts:62-64のNOTE参照）。resolveCliPathは
    // cliPathCacheでプロセス生存期間中1回のみ再解決を試みるため多重発火もしない（#779）。
    test: /\[resolveCliPath\] Failed to resolve .+, using relative path/i,
    logger: /claude-code-agent/i,
    because:
      'shell:trueによるspawnがcmd.exeで実行時にPATHを再解決するためCLI実行には影響しない — fail-openで継続している',
  },
  {
    // ログ出力箇所: claude-code-agent/agent-core.ts の stop()/killProcessForQuestion()、
    // codex-cli-agent/index.ts、gemini-cli-agent/process-manager.ts の各 taskkill 呼び出し。
    // log-format-parser.ts:82 は err が付与されたログで err.message を msg として優先す
    // るため、normalizedMsg は呼び出し元のカスタム文言ではなく execSync が投げる
    // 「Command failed: taskkill /PID # /T /F」に統一される（#810）。taskkill の失敗は
    // 大半が対象PIDが呼び出し時点で既に終了済みのレース（agent-process-tracker.ts:230-236
    // のコメントが同種の失敗を「likely means the process already exited」と説明）で、直後の
    // process.kill() フォールバックが回復する。フォールバックまで失敗した場合は別シグネチャ
    // 「process.kill() also failed」（既にwarnで記録済み）として可視性が残る。
    test: /Command failed: taskkill \/PID # \/T \/F/i,
    logger: /claude-code-agent|codex-cli-agent|gemini-cli-agent/i,
    because:
      'taskkillの第一試行失敗は対象PIDが既に終了済みのレースが大半で、process.kill()フォールバックが回復する — フォールバックも失敗した場合は別シグネチャで可視化される',
  },
  {
    // ログ出力箇所: worktree-remove.ts:154-158 の logger.warn（removeWorktree内、
    // git worktree remove の catch ブロック）。「is not a working tree」は当該
    // パスの登録エントリが既に prune 済み/削除済みであることを示すだけで、直後の
    // 187-191行がexistsSync(worktreePath)===falseならremoved=trueとして扱う
    // フォールバック（実質的に既に望む終了状態）。恒久的に削除できないケースは
    // 別シグネチャ「Could not remove ... after retries」「REFUSED fs cleanup」で
    // 可視化されるため、本ルールで恒久失敗の可視性は失われない（#824）。
    test: /Command failed: git worktree remove .* is not a working tree/i,
    logger: /git-operations\/worktree-ops/i,
    because:
      'git worktree remove失敗は登録エントリの陳腐化を示すだけで、直後のfsフォールバックが既に削除済み状態として扱う — 恒久失敗は別シグネチャ(Could not remove.../REFUSED fs cleanup)で可視化される',
  },
  {
    // ログ出力箇所: auto-run-idle-timer.ts:300-303 の stopThemeForIdleTimeout。
    // 新規起票が無いテーマの自動実行を安全側に停止する、設計どおりのidle-stop処理
    // (task 784)。DB更新に成功した後の記録ログであり、直前のDB書き込み失敗
    // ('stopThemeForIdleTimeout write failed', 同ファイル297行目)とは別文言のため
    // 本ルールでは対象外のまま残り、書き込み失敗の可視性は失われない。停止は
    // 同一関数内で logCycleEvent('auto_run.idle_stopped', …) と notifyIdleStopped()
    // により、サイクルログ・in-app通知の2経路で既に可視化されている（#823）。
    test: /Idle-stop timer expired for theme # \(enabled=false\)/i,
    logger: /auto-run:idle-timer/i,
    because:
      'idle-stopタイマーが満了しテーマの自動実行を停止した設計どおりの記録 — logCycleEventとnotifyIdleStoppedで既に可視化されている',
  },
  {
    // ログ出力箇所: routes/workflow/workflow-auto-commit.ts:487 の log.warn
    // （performAutoCommitAndPR内）。task 816 で log.error → log.warn へ格下げ済み
    // （同ファイル486行目のNOTE）だが、格下げ後もWARN以上を懸念化する
    // groupEntries（log-health-check.ts:208）の対象から漏れておらず、task 821/
    // K-8422として再度起票された。worktreePathはDBから消さず（489行目のブロック
    // のみ実行、null化は成功時のみ）30分毎のcleanupOrphanedWorktreesスケジューラ
    // が同一パスを再試行して自己修復する設計であり、直すべき欠陥は無い。恒久的に
    // 回収できないケースは別シグネチャ「[cleanupOrphanedWorktrees] Failed to
    // remove orphaned directory after retries」（logger: git-operations/
    // worktree-ops）で可視化され続けるため、本ルールで恒久失敗の可視性は失われない。
    test: /\[Workflow\] Worktree cleanup failed: <path>/i,
    logger: /routes:workflow:auto-commit/i,
    because:
      'cleanupOrphanedWorktreesスケジューラが30分毎に同一パスを再試行して自己修復する — 恒久失敗は別シグネチャ(git-operations/worktree-ops)で可視化される',
  },
  {
    // ログ出力箇所: services/agents/orchestrator/git-operations/worktree/
    // worktree-cleanup.ts:216-218 の logger.warn（cleanupOrphanedWorktrees内、
    // removeWorktreeがfalseを返した分岐）。falseは worktree-remove.ts:58-85 の
    // 保護ガード（未コミット作業の保全・.gitメタデータ欠落・保全を証明できない）が
    // 削除を拒否した結果で、防いだ側であり何も壊れていない。拒否時はDBの
    // worktreePathを残すため周期ごとに同一パスで再発する（task-997で13回、
    // task-1015で7回 = #1029）。拒否の根本原因は worktree-remove.ts:68/73/79 が
    // 別シグネチャ（「Preserving uncommitted work」等）で必ず記録するため、
    // 本ルールで恒久的な滞留の可視性は失われない。
    test: /\[cleanupOrphanedWorktrees\] removeWorktree refused for # session\(s\)/i,
    logger: /git-operations\/worktree-ops/i,
    because:
      'removeWorktreeの保護ガードが未コミット作業等を守って削除を拒否した記録 — 拒否理由は worktree-remove.ts が別シグネチャで記録し、周期再試行で同一パスが再出力されるだけ',
  },
  {
    // ログ出力箇所: runtime-smoke/app-launcher.ts:154-164 の waitForHealthy()。
    // 呼び出し元は runtime-check.ts:144（検証ゲート経路）と
    // preview-session-manager.ts:191（ライブプレビュー経路）の2箇所。検証ゲート
    // 経路のタイムアウトは、環境起因ならrunRuntimeSmokeCheckがfail-openで継続し
    // （別シグネチャ「launch failed with an ENVIRONMENT signature — skipping
    // (fail-open)」、logger: runtime-smoke、既に抑制済み）、実欠陥なら
    // automated-verifier.tsのchecksに積まれてAutomated verification failed（既に
    // 抑制済み）が追随発火するため、本ルールでいずれの経路の可視性も失われない。
    // ライブプレビュー経路は logger が異なる preview-session が別文言
    // 「dev server did not become healthy in time」を出すため対象外のまま残る
    // （#862）。
    test: /\[runtime-smoke\] health check timed out/i,
    logger: /runtime-smoke:launcher/i,
    because:
      'waitForHealthyのタイムアウトは呼び出し元(検証ゲート/ライブプレビュー)が既存の別シグネチャで結果を追随記録する — ポーリング過程のtelemetryであり単体では壊れた状態を示さない',
  },
  {
    // ログ出力箇所: git-operations/pr/pr-merge-ops.ts:154-157 の logger.warn
    // （mergePullRequest内）。gh pr merge --delete-branch はGitHub側マージを先に
    // 行い最後にローカルブランチ削除をするため、タスクworktreeが同ブランチを
    // チェックアウト中だと削除だけ失敗して非0終了する。このWARNは
    // readAuthoritativeMergeState が MERGED を確認した後にのみ出力され（152-153行）、
    // 続けて pr view で再検証する（160-178行）。実マージ失敗は throw 経路で
    // success:false となり別文言で可視化されるため、本ルールで失敗は隠れない（#1028）。
    test: /Command failed: .*gh\.exe pr merge .*failed to delete local branch/is,
    logger: /git-operations\/pr-merge-ops/i,
    because:
      'ローカルブランチ削除の失敗はGitHub上でMERGED確認済みの後にのみ出る回復記録 — 実マージ失敗はsuccess:falseの別経路で可視化される',
  },
  {
    // ログ出力箇所: event-loop-lag-watchdog.ts:121-124 の log.warn（500ms間隔の
    // ポーリングで2000ms超のイベントループ停止を検知した時点）。過去6回の発生
    // （K-8776, K-9142, K-11160, K-11233, 本タスク#1040の元WARN）はいずれも単発
    // 15秒未満・2時間規模の分散で、self-heal閾値（同ファイル35行目
    // CATASTROPHIC_STALL_MS=15_000、37-45行目 CUMULATIVE_WINDOW_MS=120_000 /
    // CUMULATIVE_TRIGGER_MS=30_000）に一度も到達していない。ウォッチドッグ自体は
    // 正常に動作しており、日常的なDB/エージェント処理の負荷ピーク下で数秒単位の
    // イベントループ停止が発生すること自体は許容範囲として設計された閾値の内側。
    // 発生元の特定手段（activeSections診断）はtask 1040で workflow-runner.ts の
    // processQueue と theme-auto-run-scheduler.ts の advanceTheme にも拡張済みで、
    // 次回15秒以上の真の病的スタールが起きればself-heal（別ログ「Self-healing
    // restart triggered」、ERRORレベル、抑制対象外）が引き続き検知する。
    test: /^Event loop stalled ~#(?:\.#)?s$/,
    logger: /event-loop-lag/i,
    because:
      '過去6回すべてself-heal閾値(単発15秒/累積120秒間に30秒)未到達 — ウォッチドッグは正常動作しており、閾値超の病的スタールは別シグネチャ(Self-healing restart triggered, ERROR)で引き続き検知される',
  },
  {
    // ログ出力箇所: requirement-replan-commit.ts:134 の assertReviewedTaskCurrent
    // （汎用Error）。stale_taskはEXPECTED_REPLAN_HOLD_REASONS
    // (requirement-replan-policy.ts:48-55)に含まれ、isExpectedReplanHold(#1041)が
    // trueを返す限りRequirementReplanHeldError（AppError派生、別文言
    // "Requirement replan review held: ..."）経由で処理され、error-handler.ts:156-162の
    // AppError分岐はlog.errorを呼ばずに応答するため本行の汎用Errorは発生しない。
    // タスク#1046で報告されたスタックトレースの行番号（requirement-replan-commit.ts:122）
    // は現行の投げ元行（134）と一致せず、#1041でNOTEコメントが追加される前の
    // 旧ビルドが出力した陳腐化したログと判定した（K-11230/K-11231/K-11287と同一シグネチャ）。
    test: /^Reviewed external work held: stale_task$/i,
    logger: /error-handler/i,
    because:
      'stale_taskはisExpectedReplanHold(#1041)でRequirementReplanHeldError経由に分類され、本行の汎用Errorには到達しない — スタックトレースの行番号不一致(122≠134)から#1041適用前の旧ビルドが出力した陳腐化ログと判定',
  },
  {
    // ログ出力箇所: queue-wait-exemption.ts:110-118 の liveOrQueuedBehind が
    // 出す log.warn（verdict.waiting=false の分岐）。reason=no_own_queued /
    // no_other_running はハング防止ガードの適用除外を与えないという正規の
    // 既定分岐（同ファイル33-39行 QueueWaitReason 型、queue-wait-exemption.test.ts
    // で個別ユニットテスト済み）であり、いずれの分岐も欠陥ではない。force-stop
    // が実際に発生した場合は auto-run-active-decision.ts:160-163 の専用WARN
    // 「Task # exceeded wall budget … — force-stopping …」と
    // logCycleEvent('task.hang_backstop', …) が別途発行されるため、本行を
    // 抑制してもハング防止の可視性は損なわれない（#1053）。reason=lookup_error
    // （explainQueueWait の catch 分岐、同ファイル84-90行）は本物の照会失敗の
    // ため対象外のまま残す。
    test: /^\[ThemeAutoRunScheduler\] liveOrQueuedBehind\(task #\) = false \(reason: (no_own_queued|no_other_running)\)$/,
    logger: /theme-auto-run-scheduler/i,
    because:
      'ハング防止ガードの適用除外を与えない正規の既定分岐 — force-stop実発生時は別WARN(Task # exceeded wall budget … — force-stopping)で引き続き可視化される',
  },
  {
    // ログ出力箇所: claude-cli-provider.ts:272-274 の setTimeout が
    // `Claude CLI timed out after ${timeoutMs}ms` で fail() → 261行目の
    // reject(new ClaudeCliUnavailableError(message))。呼び出し元
    // innovation-session.ts:242-253 の generateForTheme() が try/catch で確実に
    // 捕捉し、log.warn({ err, themeId }, 'Innovation generation failed for theme')
    // を出してから return 0 で後続テーマの処理を継続する（例外は
    // runInnovationSession() のループへ伝播しない）。log-format-parser.ts:82 の
    // msg 優先順位により、実際に記録される正規化メッセージは err.message
    // （＝本タイムアウト文言）になる。submitIdea() は content hash で dedup
    // されるため、このテーマのアイデア生成は次回実行時に再試行される（#1050）。
    test: /^Claude CLI timed out after #ms$/i,
    logger: /memory:innovation-session/i,
    because:
      'generateForTheme()のtry/catchが確実に捕捉しreturn 0で後続テーマ処理を継続する（innovation-session.ts:242-253）— タスク失敗に波及せず、次回実行時に再試行される想定内の失敗モード',
  },
  {
    // ログ出力箇所: workflow-cli-executor-epilogue.ts:249 の log.warn。
    // validateVerify（phase-output-validator.ts:170-184）の
    // hasNonpassingVerifyVerdict 分岐が組み立てた summary をそのまま出す
    // fail-soft な観測用ログであり、実際の repair/block 判定は同じ
    // validateVerify() を再度呼ぶ別経路（status-transition.ts:207-260 /
    // workflow-cli-executor-verify-gate.ts:97-154）が担う（同ファイル
    // 236-238行のコメント参照）。verify.md が自ら受入基準未達（❌）を
    // 報告した記録であり、判定ロジック側の誤検知ではない（#1049。
    // K-11292/K-9668/K-8051は同一メッセージの未抑制な再発）。
    // 後続の «...» 部分は verify.md ごとに可変のため固定句のみにマッチさせる。
    test: /verify\.md explicitly reports a failed or partial overall verdict; repair is required\./i,
    logger: /workflow-cli-executor/i,
    because:
      '検証ゲートがverify.md自身の受入基準未達（❌）報告を捕捉した — ゲートが働いた側であり、判定ロジックの誤りではない',
  },
];
