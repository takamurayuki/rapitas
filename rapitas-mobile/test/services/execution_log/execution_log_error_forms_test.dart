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

    test('閉じた後の行はふつうに分類する（後続の発言を本文に吸わない）', () {
      final d = _digest([logRow(0, '$chunk続けて別の方法を試します。\n', time: at(5))]);
      expect(d.events.map((e) => e.kind), [ExecLogKind.error, ExecLogKind.speech]);
      expect(d.events.last.body, '続けて別の方法を試します。');
    });

    test('1行の [System Error: …] は従来どおり', () {
      final d = _digest([logRow(0, '[System Error: API rate limit exceeded]\n', time: at(5))]);
      expect(d.events.single.kind, ExecLogKind.error);
      expect(d.events.single.body, 'API rate limit exceeded');
    });
  });
}
