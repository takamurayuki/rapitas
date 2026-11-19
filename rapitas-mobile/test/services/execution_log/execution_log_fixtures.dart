/// 実行ログの chunk の実測フィクスチャ（ダミーの内容。形はバックエンドの記録側の書式そのもの）。
///
/// 出所（rapitas-backend、develop 0de92fa9）：
/// - type：`services/agents/orchestrator/log-chunk-manager.ts` が `isError ? 'stderr' : 'stdout'` の2値だけを書く
/// - chunk：エージェントの emitOutput 1回 = 1 chunk（`execution-handlers.ts` の setOutputHandler → addChunk）
///   - `claude-code/claude-execution-runner.ts`：`[<名前>] Starting execution...` ほか開始時の行、stderr はそのまま
///   - `workers/output-parser-handlers.ts`：発言テキスト、`[Tool: X] info`、`[Tool Done: X] (1.2s)`、
///     `[Tool Error: X] (0.3s)`、`[Question] 質問`、`[Result: success (12.3s) $0.1234]` + 最終報告、
///     `[System: init]`、`[System: thinking_tokens]`、`[System Error: msg]`
///   - `claude-code/execution-resolver.ts`：`[<名前>] Waiting for answer...`
///   - `claude-code/idle-monitor.ts`：`[Warning] N seconds elapsed ...`、`[Timeout] ...`、`[<名前>] Process has been unresponsive ...`
///   - `codex-cli-agent/json-event-handler.ts`：`[Command] cmd を開始しました`、`[Command Done] cmd (1.0s, exit 0)`、
///     `[Command Failed] cmd (2.0s, exit 1)` + 出力末尾、`[質問] 質問`、`[Error] msg`、`[Result: failed]` + 理由
///   - `codex-cli-agent/process-runner.ts`：`[情報] N秒経過: ...`、`[Codex 終了コード N] stderr (末尾4KB):` + 本文
///   - `orchestrator/fallback-executor.ts`：`[フォールバック] 理由 を検出。名前 (種別) で再実行します...`
library;

/// API の1行（GET /tasks/:id/execution-logs の logs[i]）を作る。
Map<String, dynamic> logRow(int seq, String chunk,
        {String type = 'stdout', String time = '2026-11-20T01:00:00.000Z', int? executionIndex, int? executionId}) =>
    {
      'id': 1000 + seq,
      'chunk': chunk,
      'type': type,
      'sequence': seq,
      'timestamp': time,
      if (executionIndex != null) 'executionIndex': executionIndex,
      if (executionId != null) 'executionId': executionId,
    };

String at(int second) => '2026-11-20T01:${(second ~/ 60).toString().padLeft(2, '0')}:'
    '${(second % 60).toString().padLeft(2, '0')}.000Z';

/// Claude Code の実行開始〜作業〜発言〜完了（stdout だけ）
final claudeHappyPath = [
  logRow(0, '[Claude Code] Starting execution...\n', time: at(0)),
  logRow(1, '[Claude Code] Model: claude-sonnet-5-5\n', time: at(0)),
  logRow(2, '[Claude Code] Working directory: /home/dummy/repo\n', time: at(0)),
  logRow(3, '[Claude Code] Timeout: 1800s\n', time: at(0)),
  logRow(4, '[Claude Code] Prompt: 【ダミー】ログイン画面のエラー表示を直す ...\n\n', time: at(0)),
  logRow(5, '[Claude Code] Process PID: 4242\n', time: at(1)),
  logRow(6, '[System: init]\n', time: at(2)),
  logRow(7, '[System: thinking_tokens]\n', time: at(3)),
  logRow(8, 'まずログイン画面の実装を確認します。\n[Tool: Read] -> login_screen.dart\n', time: at(5)),
  logRow(9, '[Tool Done: Read] (0.2s)\n', time: at(5)),
  logRow(10, '\n[Tool: Grep] pattern: showError\n', time: at(6)),
  logRow(11, '[Tool Done: Grep] (0.4s)\n', time: at(6)),
  logRow(12, '\n[Tool: Edit] -> login_screen.dart\n', time: at(8)),
  logRow(13, '[Tool Error: Edit] (0.1s)\n', time: at(8)),
  logRow(14, '\n[Tool: Edit] -> login_screen.dart\n', time: at(9)),
  logRow(15, '[Tool Done: Edit] (0.1s)\n', time: at(9)),
  logRow(16, '\n[Tool: Bash] \$ flutter test test/login_test.dart\n', time: at(10)),
  logRow(17, '[Tool Done: Bash] (21.4s)\n', time: at(31)),
  logRow(18, 'エラー表示を赤字に変え、テストが通ることを確認しました。\n次にコミットします。', time: at(32)),
  logRow(19, '\n[Result: success (95.2s) \$0.4210]\n修正が完了しました。ログイン失敗時に赤字で理由を表示します。\n',
      time: at(95)),
];

/// 質問で止まった実行（Claude：question-detected の chunk の後に、同じ質問を含む assistant の chunk が来る）
final claudeQuestion = [
  logRow(0, '[Claude Code] Starting execution...\n', time: at(0)),
  logRow(1, '\n[Tool: Read] -> settings.dart\n', time: at(3)),
  logRow(2, '[Tool Done: Read] (0.1s)\n', time: at(3)),
  logRow(3, '\n[Question] 通知の既定値はオンとオフのどちらにしますか？\n', time: at(10)),
  logRow(4, '設定画面の既定値を決める必要があります。\n[Question] 通知の既定値はオンとオフのどちらにしますか？\n',
      time: at(10)),
  logRow(5, '\n[Claude Code] Waiting for answer...\n', time: at(11)),
];

/// エラーで終わった実行（stderr・System Error・失敗の Result）
final claudeError = [
  logRow(0, '[Claude Code] Starting execution...\n', time: at(0)),
  logRow(1, 'Error: connect ECONNREFUSED 127.0.0.1:443\n', type: 'stderr', time: at(4)),
  logRow(2, '    at TCPConnectWrap.afterConnect\n', type: 'stderr', time: at(4)),
  logRow(3, '[System Error: API rate limit exceeded]\n', time: at(5)),
  logRow(4, '\n[Result: error_max_turns (40.0s) \$0.0100]\n', time: at(40)),
];

/// Codex の書式（Command 系・[質問]・[情報]・終了コード・失敗の Result）
final codexMixed = [
  logRow(0, '[Codex] Starting execution...\n', time: at(0)),
  logRow(1, '\n[情報] 30秒経過: Codex は内部処理中です。応答をお待ちください。タイムアウトは 1800秒です。\n', time: at(30)),
  logRow(2, '\n[情報] 60秒経過: Codex は内部処理中です。応答をお待ちください。タイムアウトは 1800秒です。\n', time: at(60)),
  logRow(3, '[Command] npm test を開始しました\n', time: at(61)),
  logRow(4, '[Command Failed] npm test (3.2s, exit 1)\nFAIL src/app.test.ts\n  expected 1 but got 2\n', time: at(64)),
  logRow(5, '[Error] stream disconnected\n', time: at(65)),
  logRow(6, '\n[Codex 終了コード 1] stderr (末尾4KB):\nfatal: not a git repository\n', time: at(66)),
  logRow(7, '\n[Result: failed]\nturn failed: model overloaded\n', time: at(66)),
];

/// フォールバック・警告・停止・その他のタグ
final miscTags = [
  logRow(0, '\n[フォールバック] rate_limit を検出。Codex (codex) で再実行します...\n', time: at(0)),
  logRow(1, '\n[Warning] Failed to resume specified session (abcd1234...). Continuing with new session (efgh5678...). Previous context may have been lost.\n',
      time: at(1)),
  logRow(2, '[Mystery] 未知のタグの行\n', time: at(2)),
  logRow(3, '\n[Claude Code] Stopping execution...\n', time: at(3)),
];
