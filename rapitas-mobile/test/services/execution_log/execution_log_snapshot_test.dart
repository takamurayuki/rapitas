import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_snapshot.dart';

import 'execution_log_fixtures.dart';

void main() {
  test('単一実行モードの応答から chunk・type・状態・質問・エラーを読む', () {
    final s = ExecutionLogSnapshot.fromJson({
      'executionId': 2806,
      'status': 'waiting_for_input',
      'logs': [logRow(0, 'a\n'), logRow(1, 'b\n', type: 'stderr')],
      'question': 'どちらにしますか？',
      'errorMessage': null,
    });
    expect(s.status, 'waiting_for_input');
    expect(s.question, 'どちらにしますか？');
    expect(s.errorMessage, isNull);
    expect(s.entries.map((e) => e.chunk), ['a\n', 'b\n']);
    expect(s.entries[1].isStderr, isTrue);
    expect(s.entries[0].timestamp, DateTime.parse('2026-11-20T01:00:00.000Z'));
  });

  test('セッション全体モードは新しい実行から並んで来るので、古い実行→新しい実行の順に並べ直す', () {
    // バックエンドは executions を createdAt 降順で flatMap する（agent-audit-router.ts）
    final s = ExecutionLogSnapshot.fromJson({
      'status': 'running',
      'logs': [
        {...logRow(0, 'new-0\n', executionIndex: 0), 'question': null, 'errorMessage': '最新の失敗'},
        logRow(1, 'new-1\n', executionIndex: 0),
        logRow(0, 'old-0\n', executionIndex: 1),
        logRow(1, 'old-1\n', executionIndex: 1),
      ],
    });
    expect(s.entries.map((e) => e.chunk.trim()), ['old-0', 'old-1', 'new-0', 'new-1']);
    // 状態に添える質問・エラーは最新の実行（executionIndex 0）のもの
    expect(s.errorMessage, '最新の失敗');
  });

  test('欠けた値は空文字・stdout で補い、logs が無ければ空', () {
    final s = ExecutionLogSnapshot.fromJson({
      'logs': [
        {'id': 3, 'sequence': 2, 'timestamp': null},
      ],
    });
    expect(s.entries.single.chunk, '');
    expect(s.entries.single.type, 'stdout');
    expect(s.status, 'none');
    expect(ExecutionLogSnapshot.fromJson('broken').entries, isEmpty);
  });
}
