/// 実行ログのパネル：状態の1行＋出来事のタイムライン、詳細の生ログ、全文の展開、追随スクロールの規則。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_snapshot.dart';
import 'package:rapitas_mobile/widgets/execution_log/execution_log.dart';

import '../../services/execution_log/execution_log_fixtures.dart';

ExecutionLogSnapshot snap(List<Map<String, dynamic>> rows,
        {String status = 'running', String? question, String? errorMessage}) =>
    ExecutionLogSnapshot.fromJson({
      'status': status,
      'logs': rows,
      if (question != null) 'question': question,
      if (errorMessage != null) 'errorMessage': errorMessage,
    });

/// パネルを置く。[data] は読み直しのたびに呼ばれる（中身を差し替えて新着を作れる）
Future<ProviderContainer> pumpPanel(WidgetTester tester, ExecutionLogSnapshot Function() data) async {
  final container = ProviderContainer(overrides: [
    taskExecutionLogsProvider.overrideWith((ref, key) async => data()),
    executionLogPollIntervalProvider.overrideWithValue(null),
  ]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(
      home: Scaffold(body: ExecutionLogPanel(title: '【ダミー】タスク', taskId: '1', executionId: '9')),
    ),
  ));
  await tester.pump();
  await tester.pump();
  return container;
}

void main() {
  testWidgets('実行中：状態の1行と出来事のタイムラインを出し、内部の行は出さない', (tester) async {
    await pumpPanel(tester, () => snap(claudeHappyPath.sublist(0, 17)));

    expect(find.byKey(const ValueKey('exec-log-status')), findsOneWidget);
    expect(find.text('実行中'), findsOneWidget);
    expect(
      tester.widget<Text>(find.byKey(const ValueKey('exec-log-status-description'))).data,
      contains('flutter test'),
    );
    expect(find.byKey(const ValueKey('exec-log-timeline')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-log-event-start')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-log-event-work')), findsOneWidget);
    expect(find.textContaining('作業 5件'), findsOneWidget);
    expect(find.textContaining('Process PID'), findsNothing);
    expect(find.textContaining('Working directory'), findsNothing);
    expect(find.textContaining('[Tool'), findsNothing);
    expect(find.byKey(const ValueKey('exec-log-hidden-note')), findsOneWidget);
    // 生ログは既定で閉じている
    expect(find.byKey(const ValueKey('exec-log-raw')), findsNothing);
  });

  testWidgets('「詳細」で生ログを全件・加工なしで見られ、戻すとタイムラインに戻る', (tester) async {
    await pumpPanel(tester, () => snap(claudeHappyPath));

    await tester.tap(find.byKey(const ValueKey('exec-log-raw-toggle')));
    await tester.pump();

    expect(find.byKey(const ValueKey('exec-log-raw')), findsOneWidget);
    final raw = tester.widget<ListView>(find.byKey(const ValueKey('exec-log-raw')));
    expect(raw.childrenDelegate.estimatedChildCount, claudeHappyPath.length);
    await tester.drag(find.byKey(const ValueKey('exec-log-raw')), const Offset(0, 3000));
    await tester.pump();
    expect(find.textContaining('[Claude Code] Process PID: 4242'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('exec-log-raw-toggle')));
    await tester.pump();
    expect(find.byKey(const ValueKey('exec-log-timeline')), findsOneWidget);
  });

  testWidgets('「詳細」は chunk を末尾の改行・空行・空白まで含めてそのまま出す', (tester) async {
    final chunks = ['[Tool: Read] -> a.dart\n', '【ダミー】発言  \n\n', '   ', 'tail\r\n\n\n', '\n[System: init]\n'];
    await pumpPanel(tester, () => snap([for (var i = 0; i < chunks.length; i++) logRow(i, chunks[i], time: at(i))]));
    await tester.tap(find.byKey(const ValueKey('exec-log-raw-toggle')));
    await tester.pump();

    final shown = tester
        .widgetList<SelectableText>(
            find.descendant(of: find.byKey(const ValueKey('exec-log-raw')), matching: find.byType(SelectableText)))
        .map((t) => t.data)
        .toList();
    expect(shown, chunks);
  });

  testWidgets('入力待ち：質問は全文で必ず出し、状態の1行にも質問を出す', (tester) async {
    await pumpPanel(
        tester,
        () => snap(claudeQuestion,
            status: 'waiting_for_input', question: '通知の既定値はオンとオフのどちらにしますか？'));

    expect(find.text('入力待ち'), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-log-event-question')), findsOneWidget);
    final body = tester.widget<Text>(find.byKey(const ValueKey('exec-log-event-body-question')));
    expect(body.data, '通知の既定値はオンとオフのどちらにしますか？');
    expect(body.maxLines, isNull);
  });

  testWidgets('エラー：エラーの出来事と状態の1行を出す', (tester) async {
    await pumpPanel(tester, () => snap(claudeError, status: 'failed', errorMessage: 'API rate limit exceeded'));

    expect(find.byKey(const ValueKey('exec-log-event-error')), findsNWidgets(3));
    expect(find.text('エラー'), findsWidgets);
    expect(find.text('2行'), findsOneWidget); // stderr 2行をまとめた件数
    expect(find.textContaining('API rate limit exceeded'), findsNWidgets(2)); // 状態の1行と出来事
  });

  testWidgets('長い発言は先頭だけ出し、タップで全文。作業はタップで内訳', (tester) async {
    final long = List.generate(6, (i) => '【ダミー】説明の${i + 1}行目').join('\n');
    await pumpPanel(
        tester,
        () => snap([
              logRow(0, '$long\n'),
              logRow(1, '\n[Tool: Read] -> a.dart\n'),
              logRow(2, '\n[Tool: Edit] -> a.dart\n'),
            ]));

    Text speech() => tester.widget<Text>(find.byKey(const ValueKey('exec-log-event-body-speech')));
    expect(speech().maxLines, 3);
    await tester.tap(find.byKey(const ValueKey('exec-log-event-speech')));
    await tester.pump();
    expect(speech().maxLines, isNull);

    expect(find.byKey(const ValueKey('exec-log-event-body-work')), findsNothing);
    await tester.tap(find.byKey(const ValueKey('exec-log-event-work')));
    await tester.pump();
    expect(tester.widget<Text>(find.byKey(const ValueKey('exec-log-event-body-work'))).data,
        '読み取り: a.dart\n編集: a.dart');
  });

  group('追随スクロール（チャット画面と同じ規則）', () {
    List<Map<String, dynamic>> rows(int n) =>
        [for (var i = 0; i < n; i++) logRow(i, '【ダミー】発言その$i\n二行目\n', time: at(i))];

    ScrollPosition position(WidgetTester tester) =>
        tester.state<ScrollableState>(find.byType(Scrollable).first).position;

    testWidgets('開いた直後は末尾、末尾付近にいれば新着に追随する', (tester) async {
      var data = rows(40);
      final container = await pumpPanel(tester, () => snap(data));
      expect(position(tester).pixels, position(tester).maxScrollExtent);

      data = rows(50);
      container.invalidate(taskExecutionLogsProvider);
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(position(tester).maxScrollExtent, greaterThan(0));
      expect(position(tester).pixels, position(tester).maxScrollExtent);
    });

    testWidgets('遡って読んでいる間は新着が来ても位置を動かさない', (tester) async {
      var data = rows(40);
      final container = await pumpPanel(tester, () => snap(data));
      position(tester).jumpTo(0);
      await tester.pump();

      data = rows(50);
      container.invalidate(taskExecutionLogsProvider);
      await tester.pump();
      await tester.pump();
      await tester.pump();
      expect(position(tester).pixels, 0);
    });
  });
}
