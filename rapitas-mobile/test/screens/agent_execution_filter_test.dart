/// Executions screen filter bar: theme filter across all three sections
/// (auto-run cards included), counts, the no-match state vs the truly-empty
/// state, clearing, sort / status, and keeping the conditions after leaving.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

Task _task(String id, String title, String themeId) => Task(
      id: id,
      title: title,
      themeId: themeId,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

final _tasks = [
  _task('21', '【ダミー】ログイン画面の修正', '1'),
  _task('22', '【ダミー】通知の設定画面', '2'),
  _task('23', '【ダミー】ログ出力の整理', '1'),
];

const _titles = {'21': '【ダミー】ログイン画面の修正', '22': '【ダミー】通知の設定画面', '23': '【ダミー】ログ出力の整理'};

DateTime _at(int hour) => DateTime(2026, 11, 17, hour);

final _executing = [
  ExecutingTask(executionId: 'e21', sessionId: 's21', taskId: '21', executionStatus: 'running', startedAt: _at(9)),
  ExecutingTask(executionId: 'e22', sessionId: 's22', taskId: '22', executionStatus: 'running', startedAt: _at(11)),
  ExecutingTask(
      executionId: 'e23', sessionId: 's23', taskId: '23', executionStatus: 'waiting_for_input', startedAt: _at(10)),
];

final _resumable = [
  ResumableExecution(id: 'r1', taskId: '22', taskTitle: '【ダミー】中断した通知の実行', status: 'interrupted', canResume: true),
];

late ProviderContainer _container;

Future<void> _pump(
  WidgetTester tester, {
  List<ExecutingTask>? executing,
  FakeThemeAutoRunService? service,
  bool freshContainer = true,
}) async {
  tester.view.physicalSize = const Size(1170, 4200); // 縦長にして下の節まで一度に組み立てる
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({});
  if (freshContainer) {
    _container = ProviderContainer(overrides: [
      ...autoRunScreenOverrides(
          service ?? FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': idleSnapshot('2')}), dummyThemes),
      executingTasksProvider.overrideWith((ref) async => executing ?? _executing),
      resumableExecutionsProvider.overrideWith((ref) async => _resumable),
      taskTitleLookupProvider.overrideWithValue(_titles),
      taskListProvider.overrideWith((ref, filter) async => _tasks),
    ]);
    addTearDown(_container.dispose);
  }
  await tester.pumpWidget(UncontrolledProviderScope(
    container: _container,
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await _settle(tester);
}

/// 実行中タイルのスピナーは止まらないので pumpAndSettle ではなく一定時間だけ進める
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

Finder _menuItem(String text) => find.descendant(
      of: find.byWidgetPredicate((w) => w is CheckedPopupMenuItem),
      matching: find.text(text),
    );

List<String> _order(WidgetTester tester, Iterable<String> titles) {
  final shown = titles.where((t) => find.text(t).evaluate().isNotEmpty).toList();
  shown.sort((a, b) => tester.getTopLeft(find.text(a)).dy.compareTo(tester.getTopLeft(find.text(b)).dy));
  return shown;
}

void main() {
  testWidgets('絞り込みバーは自動実行セクションより上にあり、既定では件数もクリアも出さない', (tester) async {
    await _pump(tester);

    final search = find.byKey(const ValueKey('exec-filter-search'));
    expect(search, findsOneWidget);
    expect(tester.getTopLeft(search).dy, lessThan(tester.getTopLeft(find.text('自動実行')).dy));
    expect(find.byKey(const ValueKey('exec-filter-clear')), findsNothing);
    expect(find.textContaining('件中'), findsNothing);
    // 既定は新しい順
    expect(_order(tester, _titles.values), ['【ダミー】通知の設定画面', '【ダミー】ログ出力の整理', '【ダミー】ログイン画面の修正']);
  });

  testWidgets('テーマで絞ると自動実行カード・実行中・再開可能の3節が絞られ、件数を出す', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1')});
    await _pump(tester, service: service);

    await tester.tap(find.byKey(const ValueKey('exec-filter-theme')));
    await _settle(tester);
    await tester.tap(_menuItem('【ダミー】rapitas 開発'));
    await _settle(tester);

    // 自動実行中のテーマでも表示だけ絞れる
    expect(find.byKey(const ValueKey('auto-run-theme-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('auto-run-theme-2')), findsNothing);
    expect(find.text('2件中1件'), findsOneWidget); // 自動実行（開発テーマ2件中1件）
    expect(find.text('3件中2件'), findsOneWidget); // 実行中
    expect(find.text('1件中0件'), findsOneWidget); // 再開可能
    expect(find.text('【ダミー】通知の設定画面'), findsNothing);
    expect(find.byKey(const ValueKey('resumable-no-match')), findsOneWidget);
    expect(find.text('テーマ: 【ダミー】rapitas 開発'), findsOneWidget);
    expect(service.calls, isEmpty, reason: '絞り込みは自動実行の操作をしない');
  });

  testWidgets('該当なしは本当に空の表示と区別し、クリアで全件に戻す', (tester) async {
    await _pump(tester);

    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), '存在しない語');
    await _settle(tester);
    expect(find.byKey(const ValueKey('executing-no-match')), findsOneWidget);
    expect(find.byKey(const ValueKey('executing-empty')), findsNothing);
    expect(find.byKey(const ValueKey('resumable-no-match')), findsOneWidget);
    expect(find.byKey(const ValueKey('auto-run-no-match')), findsOneWidget);
    expect(find.text('条件に合うタスクはありません'), findsNWidgets(2));
    expect(find.text('3件中0件'), findsOneWidget);

    await tester.tap(find.descendant(
        of: find.byKey(const ValueKey('executing-no-match')), matching: find.text('条件をクリア')));
    await _settle(tester);
    expect(_container.read(execFilterProvider), const ExecFilter());
    expect(find.byKey(const ValueKey('executing-no-match')), findsNothing);
    expect(find.text('【ダミー】ログイン画面の修正'), findsOneWidget);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('exec-filter-search'))).controller!.text, isEmpty);
  });

  testWidgets('本当に0件でも絞り込み中なら専用の空表示は出さない', (tester) async {
    await _pump(tester, executing: const []);
    expect(find.byKey(const ValueKey('executing-empty')), findsOneWidget);

    _container.read(execFilterProvider.notifier).state = const ExecFilter(status: ExecStatusFilter.waitingForInput);
    await _settle(tester);
    expect(find.byKey(const ValueKey('executing-empty')), findsNothing);
    expect(find.byKey(const ValueKey('executing-no-match')), findsOneWidget);
    // 状態は再開可能・自動実行を絞らない
    expect(find.byKey(const ValueKey('resumable-no-match')), findsNothing);
    expect(find.byKey(const ValueKey('auto-run-theme-2')), findsOneWidget);
  });

  testWidgets('検索＋古い順＋入力待ち。バーの操作で条件が変わる', (tester) async {
    await _pump(tester);

    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), 'ログ');
    await tester.tap(find.byKey(const ValueKey('exec-filter-sort')));
    await _settle(tester);
    expect(find.text('古い順'), findsOneWidget);
    expect(_order(tester, _titles.values), ['【ダミー】ログイン画面の修正', '【ダミー】ログ出力の整理']);

    await tester.tap(find.byKey(const ValueKey('exec-filter-status')));
    await _settle(tester);
    await tester.tap(_menuItem('入力待ち'));
    await _settle(tester);
    expect(_order(tester, _titles.values), ['【ダミー】ログ出力の整理']);
    expect(find.text('3件中1件'), findsOneWidget);
    expect(
      _container.read(execFilterProvider),
      const ExecFilter(query: 'ログ', sort: ExecSort.oldest, status: ExecStatusFilter.waitingForInput),
    );

    await tester.tap(find.byKey(const ValueKey('exec-filter-clear')));
    await _settle(tester);
    expect(_container.read(execFilterProvider).isDefault, isTrue);
    expect(find.byKey(const ValueKey('exec-filter-clear')), findsNothing);
  });

  testWidgets('画面を離れて戻っても条件を保つ', (tester) async {
    await _pump(tester);
    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), '通知');
    await _settle(tester);

    // 実行画面を外す（タブ移動でウィジェットが破棄されるのと同じ）
    await tester.pumpWidget(UncontrolledProviderScope(
      container: _container,
      child: const MaterialApp(home: Scaffold(body: Text('別の画面'))),
    ));
    await _settle(tester);
    expect(find.byType(AgentExecutionScreen), findsNothing);

    await _pump(tester, freshContainer: false);
    expect(tester.widget<TextField>(find.byKey(const ValueKey('exec-filter-search'))).controller!.text, '通知');
    expect(find.text('【ダミー】ログイン画面の修正'), findsNothing);
    expect(find.text('【ダミー】通知の設定画面'), findsOneWidget);
  });
}
