/**
 * log-health-suppressions
 *
 * Decides which log lines are worth filing as concerns.
 *
 * The health check used to file every warn-or-worse line it saw. Measured
 * 2026-08-27 on the rapitas backlog: 60 of 121 open concerns came from this
 * path, and almost none named anything that was left broken — a guard refusing
 * an unsafe branch switch, a reconciler recovering a starved queue, an optional
 * provider being absent. Those lines are the system WORKING.
 *
 * The rule this module encodes: a log line is a concern only when something was
 * left broken. A guard that refused, a recovery that succeeded, and a fail-open
 * that continued all leave nothing to fix, however alarming the wording.
 */

/** One suppression rule and the reason it is safe to drop the line. */
interface Suppression {
  /** Matches the normalized message (and optionally the logger name). */
  test: RegExp;
  /** Restrict to one logger when the phrase alone is too broad. */
  logger?: RegExp;
  /** When matched, this line is NOT suppressed even if `test` also matches. */
  exclude?: RegExp;
  /** Why this line leaves nothing broken. Shown in the audit log. */
  because: string;
}

/**
 * Lines that report a guard, a recovery, or an expected condition.
 *
 * Each entry names why nothing is left broken. A rule that cannot state that
 * does not belong here — the fallback is to file the concern, because a missed
 * suppression costs one noisy row while a wrong one hides a real defect.
 */
const SUPPRESSIONS: Suppression[] = [
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
    // kick が no-op になるケースの文言（同ファイル130-147行、"a kick cannot help;
    // not restarting"）は別文言のため未マッチだった。#761/#730と同型の抑制網の
    // 対象漏れ — 実際に何かが壊れているわけではなく、runner稼働中の待機を記録
    // しているだけ（#781）。
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
    // #760: 実際の呼び出し箇所の大半は "failing open"（ハイフン無し動詞句）を使っており
    // "fail-open"（ハイフン付き名詞句）のみにマッチする旧正規表現では拾えなかった。
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
    // 起票された（K-6442/K-7506）。両方の文言をここで吸収する。
    test: /Automated verification failed — (blocking|aborting auto-commit\/PR)/i,
    because: '検証ゲートが基準未達を捕捉してタスク/auto-commitを止めた — ゲートが働いた側',
  },
  {
    // 実行の結末を記録する行。原因は当の実行自身のログに出ているので、
    // ここから起票すると同じ事象が二重に上がる。
    test: /Execution ended with status: failed/i,
    because: '実行結果の記録 — 原因は当該実行のログ側に出ており、二重起票になる',
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
];

/** Result of classifying one log signature. */
export interface SuppressionVerdict {
  /** True when the line should NOT become a concern. */
  suppressed: boolean;
  /** Why, when suppressed. */
  because?: string;
}

/**
 * Whether a log line reports something that was left broken.
 *
 * @param name - Logger name. / ロガー名
 * @param normalizedMsg - Normalized message body. / 正規化済みメッセージ
 * @returns Verdict with the reason when suppressed. / 判定と理由
 */
export function classifyLogSignature(name: string, normalizedMsg: string): SuppressionVerdict {
  for (const rule of SUPPRESSIONS) {
    if (rule.logger && !rule.logger.test(name)) continue;
    if (rule.exclude && rule.exclude.test(normalizedMsg)) continue;
    if (rule.test.test(normalizedMsg)) return { suppressed: true, because: rule.because };
  }
  return { suppressed: false };
}
