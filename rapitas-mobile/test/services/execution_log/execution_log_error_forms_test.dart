/// 記録側が書くエラーの形のうち、タグだけでは見分けにくいもの（直し回1の指摘1）。
///
/// フィクスチャの形の出所（rapitas-backend、develop 0de92fa9）：
/// - Codex / Gemini の stderr は `services/agents/cli-output-filter.ts` の `filterCliDiagnosticOutput` を通り、
///   重要な行は行頭のラベルごと残して `important = true`（= logType `stderr`）で記録される。
///   下の2つは同関数に `[fatal] permission denied\n` と
///   `[fatal] permission denied\n$ npm test\nsome noise\n` を与えた実際の戻り値（display）。
/// - `[System Error: msg]` は `workers/output-parser-handlers.ts` の processSystemEvent が
///   `[System Error: ${errorMsg}]\n` で書く。errorMsg は CLI の JSON の message そのままなので改行を含みうる。
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_digest.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_line_rules.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_snapshot.dart';

import 'execution_log_fixtures.dart';

ExecLogDigest _digest(List<Map<String, dynamic>> rows) =>
    digestExecutionLog(ExecutionLogSnapshot.fromJson({'status': 'running', 'logs': rows}));

String _shown(ExecLogDigest d, ExecLogKind kind) =>
    d.events.where((e) => e.kind == kind).map((e) => '${e.title}\n${e.body ?? ''}').join('\n');

void main() {
  group('stderr の行はタグの有無にかかわらずエラーとして出す', () {
    test('未知のタグ付きの重要な診断（[fatal] …）は「その他」に落とさない', () {
      final d = _digest([
        logRow(0, '[Codex] Starting execution...\n', time: at(0)),
        logRow(1, '[fatal] permission denied\n', type: 'stderr', time: at(3)),
      ]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.start, ExecLogKind.error]);
      expect(_shown(d, ExecLogKind.error), contains('[fatal] permission denied'));
      expect(d.otherLines, 0);
    });

    test('同じ stderr chunk の [Command] 行も作業ではなくエラー出力の内訳として残す', () {
      final d = _digest([
        logRow(0, '[fatal] permission denied\n[Command] \$ npm test\n', type: 'stderr', time: at(3)),
      ]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error]);
      final error = d.events.single;
      expect(error.body, '[fatal] permission denied\n[Command] \$ npm test');
      expect(error.count, 2);
    });

    test('stdout の未知のタグは従来どおり「その他」（詳細だけ）', () {
      final d = _digest([logRow(0, '[fatal] permission denied\n', time: at(3))]);
      expect(d.events, isEmpty);
      expect(d.otherLines, 1);
    });
  });

  group('本文に改行を含む [System Error: …]', () {
    const chunk = '[System Error: API Error: 500 Internal Server Error\n'
        '{"type":"error","error":{"type":"api_error"}}\n'
        'Please retry later]\n';

    test('閉じ括弧が同じ行に無くてもエラーとして分類し、本文を全部持つ', () {
      final d = _digest([
        logRow(0, '[Claude Code] Starting execution...\n', time: at(0)),
        logRow(1, chunk, time: at(5)),
      ]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.start, ExecLogKind.error]);
      expect(d.events.last.body,
          'API Error: 500 Internal Server Error\n{"type":"error","error":{"type":"api_error"}}\nPlease retry later');
      expect(_shown(d, ExecLogKind.speech), isEmpty);
    });

    test('1行目だけでもエラーの行と判定する', () {
      expect(classifyLogLine('[System Error: API Error: 500 Internal Server Error').tag, isNot(LineTag.text));
    });

    // NOTE: 直し回1では「閉じた後の行はふつうに分類する」を確かめていたが、直し回2で chunk 単位の判定に改めた。
    // システムイベントは単独で emit されるので、同じ chunk の後ろに発言が続く形は記録側に無い。
    // 来た場合も本文に残して捨てない
    test('記録側に無い形（閉じた後に文が続く chunk）でも文を捨てず1件のエラーに残す', () {
      final d = _digest([logRow(0, '$chunk続けて別の方法を試します。\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error]);
      expect(d.events.single.body, endsWith('Please retry later]\n続けて別の方法を試します。'));
    });

    test('chunk の途中から始まる複数行エラーも、本文の行末の `]` で切らずに chunk の終わりまでを本文にする', () {
      final d = _digest([logRow(0, '再試行します。\n[System Error: Request failed\n["scope"]\nRetry exhausted]\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.speech, ExecLogKind.error]);
      expect(d.events.last.body, 'Request failed\n["scope"]\nRetry exhausted');
    });

    test('1行の [System Error: …] は従来どおり', () {
      final d = _digest([logRow(0, '[System Error: API rate limit exceeded]\n', time: at(5))]);
      expect(d.events.single.kind, ExecLogKind.error);
      expect(d.events.single.body, 'API rate limit exceeded');
    });
  });

  // 直し回2の指摘1：processSystemEvent は1件のエラーを1回の emit で書く（= 1 chunk）。
  // 外側の閉じ括弧は chunk の末尾の `]` だけで、本文の途中で行末に来た `]` ではない
  group('本文の行末に `]` がある [System Error: …]', () {
    test('途中の行が `]` で終わっても本文は chunk の終わりまで続く', () {
      final d = _digest([logRow(0, '[System Error: Request failed\n["scope"]\nRetry exhausted]\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error]);
      expect(d.events.single.body, 'Request failed\n["scope"]\nRetry exhausted');
      expect(_shown(d, ExecLogKind.speech), isEmpty);
      expect(d.otherLines, 0);
    });

    test('1行目が `]` で終わっても1行のエラーとして切らない', () {
      final d = _digest([logRow(0, '[System Error: missing ["scope"]\nRetry exhausted]\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error]);
      expect(d.events.single.body, 'missing ["scope"]\nRetry exhausted');
    });

    test('1行の本文が `]` で終わる形も末尾の閉じ括弧だけを外す', () {
      final d = _digest([logRow(0, '[System Error: missing ["scope"]]\n', time: at(5))]);
      expect(d.events.single.kind, ExecLogKind.error);
      expect(d.events.single.body, 'missing ["scope"]');
    });
  });

  // 直し回2の指摘2：重複のまとめは本文が確定してから判定する
  group('連続する System Error のまとめ', () {
    test('1行目が同じでも本文が違う複数行エラーは別の出来事', () {
      final d = _digest([
        logRow(0, '[System Error: Request failed]\n', time: at(5)),
        logRow(1, '[System Error: Request failed\nRetry exhausted]\n', time: at(6)),
      ]);
      expect(d.events.map((e) => e.body), ['Request failed', 'Request failed\nRetry exhausted']);
      expect(d.events.map((e) => e.count), [1, 1]);
    });

    test('完全に同じ複数行エラーの連続は1件にまとめて件数を出す', () {
      const chunk = '[System Error: Request failed\nRetry exhausted]\n';
      final d = _digest([logRow(0, chunk, time: at(5)), logRow(1, chunk, time: at(6))]);
      expect(d.events, hasLength(1));
      expect(d.events.single.body, 'Request failed\nRetry exhausted');
      expect(d.events.single.count, 2);
    });
  });

  // 直し回3の指摘：Codex の stderr は複数の診断行を1回で emit し（process-runner.ts）、
  // filterCliDiagnosticOutput に `[System Error: Request failed]\n[Error] Retry exhausted\n` を通すと
  // 両行が同じ chunk に残る（important = true）。後続の出来事タグの行はエラー本文に吸わない
  group('[System Error: …] で始まり、後続に出来事のタグ行がある chunk', () {
    test('後続の [Error] 行は別のエラーとして出す', () {
      final d = _digest([
        logRow(0, '[System Error: Request failed]\n[Error] Retry exhausted\n', type: 'stderr', time: at(5)),
      ]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error, ExecLogKind.error]);
      expect(d.events.map((e) => e.body), ['Request failed', 'Retry exhausted']);
    });

    test('後続の [Question] 行は質問として出し、続くタグなし行は質問の本文に付く', () {
      final d = _digest([logRow(0, '[System Error: Request failed]\n[Question] 再試行しますか？\n回数は3回まで\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error, ExecLogKind.question]);
      expect(d.events.first.body, 'Request failed');
      expect(d.events.last.body, '再試行しますか？\n回数は3回まで');
    });

    test('後続の [Tool: …] 行は作業として出す', () {
      final d = _digest([logRow(0, '[System Error: Request failed]\n[Tool: Read] -> lib/main.dart\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error, ExecLogKind.work]);
      expect(d.events.first.body, 'Request failed');
      expect(d.events.last.count, 1);
    });

    test('切り分けるのは出来事のタグ行だけで、本文の途中の `]` やタグなし行は本文に残す', () {
      final d = _digest([logRow(0, '[System Error: Request failed\n["scope"]\nsee docs]\n[Error] Retry exhausted\n', time: at(5))]);
      expect(d.events.map((e) => e.body), ['Request failed\n["scope"]\nsee docs', 'Retry exhausted']);
    });

    // 回帰防止：output-parser-handlers.ts は assistant の displayOutput に `\n[Question] ${questionText}\n` を連結する
    test('発言に [Question] 行が連結された chunk は発言と質問に分ける', () {
      final d = _digest([logRow(0, '方針を確認させてください。\n[Question] どちらの案にしますか？\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.speech, ExecLogKind.question]);
      expect(d.events.last.body, 'どちらの案にしますか？');
    });
  });
}
