import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_digest.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_snapshot.dart';

import 'execution_log_fixtures.dart';

ExecutionLogSnapshot _snap(List<Map<String, dynamic>> rows,
        {String status = 'running', String? question, String? errorMessage}) =>
    ExecutionLogSnapshot.fromJson({
      'status': status,
      'logs': rows,
      if (question != null) 'question': question,
      if (errorMessage != null) 'errorMessage': errorMessage,
    });

List<ExecLogKind> _kinds(ExecLogDigest d) => d.events.map((e) => e.kind).toList();

void main() {
  group('出来事への分類（Claude の正常系）', () {
    final digest = digestExecutionLog(_snap(claudeHappyPath, status: 'completed'));

    test('開始・発言・作業（まとめて1件）・発言・完了 の流れになる', () {
      expect(_kinds(digest), [
        ExecLogKind.start,
        ExecLogKind.speech,
        ExecLogKind.work,
        ExecLogKind.speech,
        ExecLogKind.done,
      ]);
    });

    test('ツールの呼び出しは1件の「作業」にまとめ、件数と失敗数を持つ', () {
      final work = digest.events.firstWhere((e) => e.kind == ExecLogKind.work);
      expect(work.count, 5); // Read, Grep, Edit, Edit, Bash
      expect(work.failures, 1); // Tool Error: Edit
      expect(work.title, contains('5件'));
      expect(work.items, hasLength(5));
      expect(work.items.last, contains('flutter test test/login_test.dart'));
      // Tool Done の行は項目に並べない（呼び出しの行だけ）
      expect(work.items.where((i) => i.contains('Tool Done')), isEmpty);
    });

    test('完了には最終報告の本文が付き、料金は見出しに出さない', () {
      final done = digest.events.last;
      expect(done.body, contains('修正が完了しました'));
      expect(done.title, isNot(contains(r'$')));
      expect(done.title, contains('95.2s'));
    });

    test('起動時の内部行（Model・作業ディレクトリ・PID・System など）は表に出さず件数だけ数える', () {
      final all = digest.events.map((e) => '${e.title}\n${e.body ?? ''}').join('\n');
      expect(all, isNot(contains('Process PID')));
      expect(all, isNot(contains('Working directory')));
      expect(all, isNot(contains('thinking_tokens')));
      expect(digest.hiddenLines, greaterThanOrEqualTo(7));
    });

    test('時刻は各出来事に付く（最初の chunk の時刻）', () {
      expect(digest.events.every((e) => e.time != null), isTrue);
      expect(digest.events.first.time, DateTime.parse(at(0)));
      expect(digest.events.last.time, DateTime.parse(at(95)));
    });

    test('状態の1行：completed は「完了」で最終報告の先頭を説明にする', () {
      expect(digest.state.phase, ExecLogPhase.done);
      expect(digest.state.label, '完了');
      expect(digest.state.description, contains('修正が完了しました'));
    });
  });

  group('質問（入力待ち）は必ず出す', () {
    test('同じ質問が続けて記録されても1件にまとめ、入力待ちの状態に質問を出す', () {
      final d = digestExecutionLog(_snap(claudeQuestion,
          status: 'waiting_for_input', question: '通知の既定値はオンとオフのどちらにしますか？'));
      final questions = d.events.where((e) => e.kind == ExecLogKind.question).toList();
      expect(questions, hasLength(1));
      expect(questions.single.body, '通知の既定値はオンとオフのどちらにしますか？');
      expect(d.state.phase, ExecLogPhase.waiting);
      expect(d.state.label, '入力待ち');
      expect(d.state.description, contains('通知の既定値'));
      // 「回答を待っています」の内部行は出来事にしない
      expect(d.events.map((e) => e.title).join(), isNot(contains('Waiting')));
    });

    test('ログに質問の行が無くても、実行の question があれば末尾に質問の出来事を足す', () {
      final d = digestExecutionLog(_snap([logRow(0, '[Codex] Starting execution...\n')],
          status: 'waiting_for_input', question: 'どのブランチに入れますか？'));
      expect(d.events.last.kind, ExecLogKind.question);
      expect(d.events.last.body, 'どのブランチに入れますか？');
    });

    test('stderr に出た [質問] も質問として出す', () {
      final d = digestExecutionLog(_snap([logRow(0, '\n[質問] 続けますか？\n', type: 'stderr')]));
      expect(_kinds(d), [ExecLogKind.question]);
    });
  });

  group('エラーは必ず出す', () {
    test('stderr の連続はまとめて「エラー出力」1件、System Error と失敗の Result も出す', () {
      final d = digestExecutionLog(_snap(claudeError, status: 'failed', errorMessage: 'API rate limit exceeded'));
      expect(_kinds(d), [ExecLogKind.start, ExecLogKind.error, ExecLogKind.error, ExecLogKind.error]);
      final stderr = d.events[1];
      expect(stderr.title, contains('エラー出力'));
      expect(stderr.count, 2);
      expect(stderr.body, contains('ECONNREFUSED'));
      expect(stderr.body, contains('afterConnect'));
      expect(d.events[2].body, contains('API rate limit exceeded'));
      expect(d.events[3].title, contains('error_max_turns'));
      expect(d.state.phase, ExecLogPhase.error);
      expect(d.state.description, 'API rate limit exceeded');
    });

    test('ログにエラーが無くても failed の errorMessage を末尾に出す', () {
      final d = digestExecutionLog(_snap([logRow(0, '[Codex] Starting execution...\n')],
          status: 'failed', errorMessage: 'プロセスが異常終了しました'));
      expect(d.events.last.kind, ExecLogKind.error);
      expect(d.events.last.body, 'プロセスが異常終了しました');
    });
  });

  group('Codex の書式', () {
    final d = digestExecutionLog(_snap(codexMixed, status: 'failed'));

    test('[情報] N秒経過 の連続は1件にまとめて件数を出す', () {
      final beats = d.events.where((e) => e.kind == ExecLogKind.milestone).toList();
      expect(beats, hasLength(1));
      expect(beats.single.count, 2);
    });

    test('[Command] と [Command Failed] は作業1件（失敗1）。失敗の出力末尾は発言にしない', () {
      final work = d.events.firstWhere((e) => e.kind == ExecLogKind.work);
      expect(work.count, 1);
      expect(work.failures, 1);
      expect(work.items.single, contains('npm test'));
      expect(work.detail, contains('expected 1 but got 2'));
      expect(d.events.where((e) => e.kind == ExecLogKind.speech), isEmpty);
    });

    test('[Error]・終了コード（本文付き）・失敗の Result（理由付き）はエラー', () {
      final errors = d.events.where((e) => e.kind == ExecLogKind.error).toList();
      expect(errors, hasLength(3));
      expect(errors[0].body, 'stream disconnected');
      expect(errors[1].body, contains('fatal: not a git repository'));
      expect(errors[2].body, contains('turn failed: model overloaded'));
    });
  });

  group('その他のタグ', () {
    final d = digestExecutionLog(_snap(miscTags));

    test('フォールバックとセッション再開失敗は注意、停止要求は節目', () {
      expect(_kinds(d), [ExecLogKind.warning, ExecLogKind.warning, ExecLogKind.milestone]);
      expect(d.events.last.title, '停止を要求しました');
    });

    test('分類できないタグの行は表に混ぜず「その他」として数える', () {
      expect(d.events.map((e) => '${e.title}${e.body}').join(), isNot(contains('Mystery')));
      expect(d.otherLines, 1);
    });
  });

  test('同じ内容の発言が続いたら1件にまとめて件数を出す', () {
    final d = digestExecutionLog(_snap([
      logRow(0, 'テストを実行しています\n', time: at(0)),
      logRow(1, 'テストを実行しています\n', time: at(5)),
    ]));
    expect(d.events, hasLength(1));
    expect(d.events.single.count, 2);
    expect(d.events.single.lastTime, DateTime.parse(at(5)));
  });

  test('発言をはさんで届いた [Tool Done] だけでは空の「作業」を作らない（失敗は残す）', () {
    final d = digestExecutionLog(_snap([
      logRow(0, '\n[Tool: Bash] \$ flutter test\n'),
      logRow(1, '途中経過を説明します\n'),
      logRow(2, '[Tool Done: Bash] (1.2s)\n'),
      logRow(3, '[Tool Error: Edit] (0.1s)\n'),
    ]));
    expect(_kinds(d), [ExecLogKind.work, ExecLogKind.speech, ExecLogKind.work]);
    expect(d.events.last.failures, 1);
    expect(d.events.last.title, contains('失敗'));
  });

  test('実行中の状態は最後の作業を説明にする', () {
    final d = digestExecutionLog(_snap(claudeHappyPath.sublist(0, 17)));
    expect(d.state.phase, ExecLogPhase.running);
    expect(d.state.label, '実行中');
    expect(d.state.description, contains('flutter test'));
  });

  test('ログが無い実行は「ログはまだありません」の待機状態', () {
    final d = digestExecutionLog(ExecutionLogSnapshot.fromJson({'logs': <dynamic>[], 'status': 'none'}));
    expect(d.events, isEmpty);
    expect(d.state.phase, ExecLogPhase.idle);
  });
}
