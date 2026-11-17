/// Executions screen filter in the task-screen shape: AppBar search mode,
/// filter sheet (theme → status → sort), applied-condition chips and the
/// filter badge. Covers the theme filter across all three sections (auto-run
/// cards included), counts, the no-match state vs the truly-empty state,
/// clearing, sort / status, and keeping the conditions after leaving.
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

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(ValueKey(key)));
  await _settle(tester);
}

Future<void> _openSheet(WidgetTester tester) => _tapKey(tester, 'exec-filter-open');

Finder get _sheet => find.byKey(const ValueKey('exec-filter-sheet'));

bool _badgeVisible(WidgetTester tester) => tester
    .widget<Badge>(find.descendant(of: find.byKey(const ValueKey('exec-filter-open')), matching: find.byType(Badge)))
    .isLabelVisible;

bool _chipSelected(WidgetTester tester, String key) => tester.widget<FilterChip>(find.byKey(ValueKey(key))).selected;

TextField _searchField(WidgetTester tester) => tester.widget<TextField>(find.byKey(const ValueKey('exec-filter-search')));

List<String> _order(WidgetTester tester, Iterable<String> titles) {
  final shown = titles.where((t) => find.text(t).evaluate().isNotEmpty).toList();
  shown.sort((a, b) => tester.getTopLeft(find.text(a)).dy.compareTo(tester.getTopLeft(find.text(b)).dy));
  return shown;
}

void main() {
  testWidgets('既定では常時表示のバー・チップ列・件数・Badge を出さず、AppBar に検索とフィルターだけ置く', (tester) async {
    await _pump(tester);

    expect(find.byKey(const ValueKey('exec-search-open')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-filter-open')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-filter-search')), findsNothing, reason: '検索欄は検索モードでだけ出す');
    expect(find.byType(InputChip), findsNothing);
    expect(find.textContaining('件中'), findsNothing);
    expect(_badgeVisible(tester), isFalse);
    // 既定は新しい順
    expect(_order(tester, _titles.values), ['【ダミー】通知の設定画面', '【ダミー】ログ出力の整理', '【ダミー】ログイン画面の修正']);

    // 検索語だけでは Badge を出さない（検索はモードなので対象外。タスク画面と同じ流儀）
    _container.read(execFilterProvider.notifier).state = const ExecFilter(query: 'ログ');
    await _settle(tester);
    expect(_badgeVisible(tester), isFalse);
  });

  testWidgets('シートのテーマで絞ると3節が絞られ、件数・テーマのチップ・Badge が出る。候補は開発テーマだけ', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1')});
    await _pump(tester, service: service);

    await _openSheet(tester);
    expect(_sheet, findsOneWidget);
    expect(find.descendant(of: _sheet, matching: find.text('フィルター')), findsOneWidget);
    expect(_chipSelected(tester, 'exec-sheet-theme-all'), isTrue);
    expect(find.byKey(const ValueKey('exec-sheet-theme-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-sheet-theme-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-sheet-theme-3')), findsNothing, reason: '開発テーマでない「買い物メモ」は候補に出さない');
    // カテゴリが1つ（カテゴリなしの開発テーマだけ）なのでカテゴリセクションは出さない
    expect(find.descendant(of: _sheet, matching: find.text('カテゴリ')), findsNothing);

    await _tapKey(tester, 'exec-sheet-theme-1');
    expect(_sheet, findsNothing, reason: 'テーマを選ぶと即適用して閉じる');
    expect(_container.read(execFilterProvider), const ExecFilter(themeId: '1'));
    // 自動実行中のテーマでも表示だけ絞れる
    expect(find.byKey(const ValueKey('auto-run-theme-1')), findsOneWidget);
    expect(find.byKey(const ValueKey('auto-run-theme-2')), findsNothing);
    expect(find.text('2件中1件'), findsOneWidget); // 自動実行（開発テーマ2件中1件）
    expect(find.text('3件中2件'), findsOneWidget); // 実行中
    expect(find.text('1件中0件'), findsOneWidget); // 再開可能
    expect(find.text('【ダミー】通知の設定画面'), findsNothing);
    expect(find.byKey(const ValueKey('resumable-no-match')), findsOneWidget);
    expect(find.text('テーマ：【ダミー】rapitas 開発'), findsOneWidget);
    expect(_badgeVisible(tester), isTrue);
    // チップ列は自動実行セクションより上
    expect(tester.getTopLeft(find.byKey(const ValueKey('exec-active-theme'))).dy,
        lessThan(tester.getTopLeft(find.text('自動実行')).dy));
    expect(service.calls, isEmpty, reason: '絞り込みは自動実行の操作をしない');

    // テーマのチップはタップでシートを開き直す（×なし）。「すべて」で解除できる
    final themeChip = tester.widget<InputChip>(find.byKey(const ValueKey('exec-active-theme')));
    expect(themeChip.onDeleted, isNull);
    await _tapKey(tester, 'exec-active-theme');
    expect(_chipSelected(tester, 'exec-sheet-theme-1'), isTrue);
    await _tapKey(tester, 'exec-sheet-theme-all');
    expect(_container.read(execFilterProvider), const ExecFilter());
    expect(find.byType(InputChip), findsNothing);
  });

  testWidgets('検索モードの該当なしは本当に空の表示と区別し、クリアで全件に戻す', (tester) async {
    await _pump(tester);

    await _tapKey(tester, 'exec-search-open');
    expect(_searchField(tester).autofocus, isTrue);
    expect(_searchField(tester).decoration!.hintText, 'タスク名・テーマ名で検索');
    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), '存在しない語');
    await _settle(tester);
    expect(_container.read(execFilterProvider).query, '存在しない語', reason: '入力は即時に反映する');
    expect(find.byKey(const ValueKey('executing-no-match')), findsOneWidget);
    expect(find.byKey(const ValueKey('executing-empty')), findsNothing);
    expect(find.byKey(const ValueKey('resumable-no-match')), findsOneWidget);
    expect(find.byKey(const ValueKey('auto-run-no-match')), findsOneWidget);
    expect(find.text('条件に合うタスクはありません'), findsNWidgets(2));
    expect(find.text('3件中0件'), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-filter-open')), findsNothing, reason: '検索モードの AppBar はフィルターアイコンを持たない');

    await tester.tap(find.descendant(
        of: find.byKey(const ValueKey('executing-no-match')), matching: find.text('条件をクリア')));
    await _settle(tester);
    expect(_container.read(execFilterProvider), const ExecFilter());
    expect(find.byKey(const ValueKey('executing-no-match')), findsNothing);
    expect(find.text('【ダミー】ログイン画面の修正'), findsOneWidget);
    expect(_searchField(tester).controller!.text, isEmpty, reason: '外からのクリアに入力欄も合わせる');
  });

  testWidgets('検索のクリアボタン・閉じる矢印・戻る操作。閉じると検索語は消える', (tester) async {
    await _pump(tester);

    await _tapKey(tester, 'exec-search-open');
    expect(find.byKey(const ValueKey('exec-search-clear')), findsNothing);
    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), 'ログ');
    await _settle(tester);
    expect(_order(tester, _titles.values), ['【ダミー】ログ出力の整理', '【ダミー】ログイン画面の修正']);
    await _tapKey(tester, 'exec-search-clear');
    expect(_container.read(execFilterProvider).query, isEmpty);
    expect(find.byKey(const ValueKey('exec-filter-search')), findsOneWidget, reason: 'クリアでは検索モードのまま');

    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), '通知');
    await _settle(tester);
    await _tapKey(tester, 'exec-search-close');
    expect(find.byKey(const ValueKey('exec-filter-search')), findsNothing);
    expect(_container.read(execFilterProvider).query, isEmpty);
    expect(find.text('【ダミー】ログイン画面の修正'), findsOneWidget);

    // 戻る操作（PopScope）でも閉じる
    await _tapKey(tester, 'exec-search-open');
    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), '通知');
    await _settle(tester);
    await tester.binding.handlePopRoute();
    await _settle(tester);
    expect(find.byKey(const ValueKey('exec-filter-search')), findsNothing);
    expect(_container.read(execFilterProvider).query, isEmpty);
    expect(find.byType(AgentExecutionScreen), findsOneWidget);
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

  testWidgets('古い順＋入力待ち＋検索。シートで選び、チップの×で個別に解除する', (tester) async {
    await _pump(tester);

    await _openSheet(tester);
    expect(_chipSelected(tester, 'exec-sheet-sort-newest'), isTrue);
    await _tapKey(tester, 'exec-sheet-sort-oldest');
    expect(_sheet, findsNothing);
    expect(find.text('古い順'), findsOneWidget); // 適用中チップ
    expect(_order(tester, _titles.values), ['【ダミー】ログイン画面の修正', '【ダミー】ログ出力の整理', '【ダミー】通知の設定画面']);

    await _openSheet(tester);
    expect(find.descendant(of: _sheet, matching: find.text('実行中のリストだけに効きます')), findsOneWidget);
    await _tapKey(tester, 'exec-sheet-status-waitingForInput');
    expect(find.text('状態：入力待ち'), findsOneWidget);
    expect(_badgeVisible(tester), isTrue);

    // シートの条件を入れたまま検索する（検索モードの AppBar にはフィルターアイコンが無い。タスク画面と同じ）
    await _tapKey(tester, 'exec-search-open');
    expect(find.byKey(const ValueKey('exec-filter-open')), findsNothing);
    await tester.enterText(find.byKey(const ValueKey('exec-filter-search')), 'ログ');
    await _settle(tester);
    expect(_order(tester, _titles.values), ['【ダミー】ログ出力の整理']);
    expect(find.text('3件中1件'), findsOneWidget);
    expect(
      _container.read(execFilterProvider),
      const ExecFilter(query: 'ログ', sort: ExecSort.oldest, status: ExecStatusFilter.waitingForInput),
    );

    // 状態の×は状態だけ、並び順の×は新しい順に戻すだけ（検索モード中もチップ列は出る）
    await tester.tap(find.byTooltip('状態の絞り込みを解除'));
    await _settle(tester);
    expect(_container.read(execFilterProvider), const ExecFilter(query: 'ログ', sort: ExecSort.oldest));
    await tester.tap(find.byTooltip('新しい順に戻す'));
    await _settle(tester);
    expect(_container.read(execFilterProvider), const ExecFilter(query: 'ログ'));
    expect(find.byType(InputChip), findsNothing);
    await _tapKey(tester, 'exec-search-close');
    expect(_badgeVisible(tester), isFalse);
  });

  testWidgets('画面を離れて戻っても条件を保ち、検索語は検索モードの入力欄に戻す', (tester) async {
    await _pump(tester);
    await _openSheet(tester);
    await _tapKey(tester, 'exec-sheet-sort-oldest');
    await _tapKey(tester, 'exec-search-open');
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
    expect(_searchField(tester).controller!.text, '通知');
    expect(find.text('古い順'), findsOneWidget);
    expect(find.text('【ダミー】ログイン画面の修正'), findsNothing);
    expect(find.text('【ダミー】通知の設定画面'), findsOneWidget);
  });

  testWidgets('選択中のテーマが開発テーマでなくても条件は残し、チップは全テーマから名前を出す', (tester) async {
    await _pump(tester);
    _container.read(execFilterProvider.notifier).state = const ExecFilter(themeId: '3');
    await _settle(tester);

    expect(find.text('テーマ：【ダミー】買い物メモ'), findsOneWidget);
    await _tapKey(tester, 'exec-active-theme');
    expect(find.byKey(const ValueKey('exec-sheet-theme-3')), findsNothing);
    expect(_chipSelected(tester, 'exec-sheet-theme-all'), isFalse);
    expect(_chipSelected(tester, 'exec-sheet-theme-1'), isFalse);
    expect(_chipSelected(tester, 'exec-sheet-theme-2'), isFalse);
    expect(_container.read(execFilterProvider).themeId, '3', reason: 'シートを開いただけでは解除しない');
  });
}
