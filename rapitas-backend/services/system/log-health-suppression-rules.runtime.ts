/**
 * log-health-suppression-rules.runtime
 *
 * The runtime/execution half of the suppression table: shell command failures,
 * CLI timeouts, hang detection, event-loop stalls and the scheduler's own
 * status reports. Data only — classifyLogSignature() and the types stay in
 * log-health-suppressions.ts, and the remaining rules in
 * log-health-suppression-rules.ts.
 *
 * Split out when the parent reached 494 of its 500-line hard limit and task
 * 1141's agent, adding one correct rule, pushed it to 503 and was blocked by the
 * verification gate. Rules were moved verbatim; none were edited in the move.
 */
import type { Suppression } from './log-health-suppressions-types';

/** Same contract as SUPPRESSIONS: first match wins, each entry says why nothing is broken. */
export const RUNTIME_SUPPRESSIONS: Suppression[] = [
  {
    // ログ出力箇所: runtime-server-registry-lifecycle.ts:122/311 の stopOwnedAndVerify/
    // spawnNewEntry の catch。readRuntimeProcessSnapshot()（runtime-process-snapshot.ts:118）
    // がOS プロセス列挙用PowerShellスクリプト実行で失敗（execFileのタイムアウト等）した
    // 際に発火する。タスク1110で確認: a47037f4（2026-09-27T00:17:36Z）が
    // SNAPSHOT_TIMEOUT_MS を10秒から30秒へ延長し、spawnNewEntry の起動追跡ループには
    // 3回連続失敗までリトライする自己修復も追加済みだが、開始前/停止後の単発呼び出し
    // （beforeStart/afterStop、リトライ対象外）は依然として一度の失敗で本ERRORに到達
    // し得る。ただしこの失敗はentryをquarantined状態にするのみで、次回の
    // acquireRuntimeServer（worktree-server-registry.ts:184-221）が改めてスナップショット
    // を取得し、プロセス終了・ポート解放・ディレクトリ解放を確認できた時点で自動的に
    // quarantineを解除する。確認が取れない間は unverifiable:true でfail-closedに倒れる
    // ため、誤って成功扱いになることはなく、この行を抑制しても恒久障害の可視性は失われない。
    // NOTE: normalizeMessage（log-health-check.ts:203）は正規化後のメッセージを200文字で
    // 切り詰める。windowsScript本体（runtime-process-snapshot.ts:32-44）に含まれる
    // Get-CimInstance/Get-NetTCPConnectionはこの200文字を超えた位置にあり届かないため、
    // 200文字以内で必ず生き残るスクリプト冒頭のコメント文言（同ファイル34-35行、
    // execFileがUTF-8をデコードする際にCP932のバイト列がJSONエスケープを壊す事情の説明）
    // を照合対象にする。
    test: /Command failed: powershell\.exe -NoProfile -NonInteractive -Command \$ErrorActionPreference = 'Stop' # execFile decodes UTF-#\. CP# bytes for characters such as ソ contain #/i,
    logger: /runtime-smoke:registry/i,
    because:
      'OSプロセス列挙スクリプトの単発失敗はworkdirをquarantinedにするだけで、次回acquireRuntimeServerがプロセス終了/ポート解放を再確認すると自動解除される（タイムアウトはa47037f4で30秒へ延長済み） — 未確認の間はunverifiable:trueでfail-closedのため誤って成功扱いになることはない',
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
  {
    // ログ出力箇所: services/agents/claude-code/idle-monitor.ts:112-114 の
    // logger.warn。104-111行の条件（出力受信済み・最終出力から5分超過・
    // 未フラッシュの部分行なし・status===running・プロセス生存）が全て揃った
    // 場合のみ発火する、意図的なハング検知・強制終了ロジック（#1084研究フェーズ
    // 前提監査#1で確認済み）。force-kill後の結果は即座に失敗扱いにならず、
    // execution-resolver.ts:292の`!ctx.idleTimeoutForceKilled`分岐によりgit
    // diffベースの完了判定に委ねられる（同340-344行）。529過負荷等の回復不能な
    // 障害はdetectApiOverload（execution-resolver-early-failures.ts:53-55）が
    // 別途分類するため本ルールで致命的失敗の可視性は失われない。taskkill自体の
    // 失敗も既に別シグネチャで抑制済み（本ファイル246行目）。
    test: /OUTPUT IDLE HANG DETECTED: No output for #s after producing # chars\. Force-killing hung process\./i,
    logger: /claude-code-agent/i,
    because:
      '出力受信後5分間無音という保守的な閾値でのみ発火する意図的なハング検知・自動復旧機構 — force-kill後はgit diffベースの完了判定に委ねられ、致命的失敗は別シグネチャ(529過負荷/taskkill失敗)で可視化される',
  },
  {
    // ログ出力箇所: workflow-orchestrator-protected-path-guard.ts:72-75 の
    // guardProtectedPathMode。lightweightタスクのimplementer遷移直前に
    // research.mdの「変更予定箇所」節（plannedChangeSection）を走査し、保護パス
    // （services/agents/verification/、services/workflow/{completion-gate,
    // phase-output-validator,verify-self-repair,phase-critic}* 等）への変更が
    // 計画されている場合に発火する。lightweightモードにはplan.mdが無く
    // タンパーゲートを通せないため、standardモードへ自動昇格しplanner再実行を
    // スケジュールする（タスク1044/1055で実際に検証ラウンドを失った実績あり、
    // 同ファイル10-13行）。ガードが意図通り作動した記録であり欠陥ではない
    // （タスク#1113、K-11655、発生回数1回・単発）。
    test: /research\.md plans a protected-path change in lightweight mode — escalating to standard so plan\.md can list it/i,
    logger: /workflow-orchestrator/i,
    because:
      'lightweightタスクが保護パスへの変更を計画していたためstandardモードへ自動昇格しplan.mdで対象ファイルを明記できるようにした — タンパーゲート失敗を未然に防ぐ設計通りの自己防御動作',
  },
  {
    // ログ出力箇所: workflow-cli-executor-verify-gate.ts:74-77 の log.warn。
    // hasFreshVerifyRejection（verify-self-repair.ts:340-366）または
    // wasVerifyValidationFailureJustRecorded が真、つまり HTTP の verify 保存
    // ゲートが直前に差し戻した場合だけ発火する。エピローグが差し戻しの上に
    // commit/PR/complete を重ねないための早期 return で、phaseStatus は
    // currentWfStatus を維持する。差し戻し自体は recordTransition で記録される
    // （verify-self-repair.ts:210-212）。同 logger の
    // 'Verify passed but no PR' は別文言のため抑制しない（#1145）。
    test: /Verify was rejected by a fresh gate rejection — honoring it and skipping the completion epilogue/i,
    logger: /workflow-cli-executor/i,
    because:
      '検証ゲートの直近差し戻しをエピローグが尊重して止めた設計通りの動作 — 差し戻しはtransitionに記録され別経路で可視化される',
  },
  {
    // ログ出力箇所: routes/workflow/handlers/file-save/verify-adversarial-review.ts:239
    // の log.warn。敵対的レビューがFAILを返した後、再読込したworkflowStatusが
    // verify_done でなくなっている（self-repair等で先へ進んだ）場合だけ発火する
    // (同222-231行)。完了/マージ済みタスクを plan_approved へ巻き戻さない
    // compare-and-swap 防御（task 503）で、ロールバックもtransition記録もスキップする。
    // 同 logger の 'lost the compare-and-swap race' や 'repairs exhausted' は
    // 別文言のため抑制しない（#1146）。
    test: /Adversarial review FAIL arrived after the workflow moved on — skipping rollback entirely/i,
    logger: /routes:workflow:handlers:files/i,
    because:
      '古いFAIL判定が先へ進んだタスクを巻き戻さないためのCAS防御が設計通り作動した記録 — 実害のある競合敗北・修復枯渇は別文言で可視のまま',
  },
];
