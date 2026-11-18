/// Status filter on the executions screen's auto-run section (nav73): 実行中
/// keeps only themes whose auto-run is running, 入力待ち keeps only running
/// themes whose current task is waiting for input in the executing list, and
/// the count line / no-match state follow. Display only: no auto-run action.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/models/theme_auto_run.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

ThemeAutoRunSnapshot _running(String themeId, String currentTaskId) => ThemeAutoRunSnapshot(
      state: ThemeAutoRunState(themeId: themeId, enabled: true, status: 'running', currentTaskId: currentTaskId),
      remainingCount: 3,
    );

ExecutingTask _exec(String taskId, {bool waiting = false}) => ExecutingTask(
      executionId: 'e$taskId',
      sessionId: 's$taskId',
      taskId: taskId,
      executionStatus: waiting ? 'waiting_for_input' : 'running',
    );

/// 開発テーマ 1・2・5（categorizedThemes）。1 は自動実行中で現在のタスク 31 が入力待ち、
/// 2 は自動実行中で現在のタスク 32 が実行中、5 は一時停止中
final _snapshots = {'1': _running('1', '31'), '2': _running('2', '32'), '5': pausedSnapshot('5')};

late ProviderContainer _container;

Future<FakeThemeAutoRunService> _pump(WidgetTester tester, {List<ExecutingTask>? executing}) async {
  tester.view.physicalSize = const Size(1170, 4200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({});
  final service = FakeThemeAutoRunService(_snapshots);
  _container = ProviderContainer(overrides: [
    ...autoRunScreenOverrides(service, categorizedThemes),
    executingTasksProvider.overrideWith((ref) async => executing ?? [_exec('31', waiting: true), _exec('32')]),
  ]);
  addTearDown(_container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: _container,
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await _settle(tester);
  return service;
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

Future<void> _setStatus(WidgetTester tester, ExecStatusFilter status) async {
  _container.read(execFilterProvider.notifier).state = ExecFilter(status: status);
  await _settle(tester);
}

/// 表示中の自動実行カードのテーマID（上から順）
List<String> _shownCards(WidgetTester tester) {
  final ids = [
    for (final id in ['1', '2', '5'])
      if (find.byKey(ValueKey('auto-run-theme-$id')).evaluate().isNotEmpty) id,
  ];
  double top(String id) => tester.getTopLeft(find.byKey(ValueKey('auto-run-theme-$id'))).dy;
  return ids..sort((a, b) => top(a).compareTo(top(b)));
}

void main() {
  testWidgets('状態＝実行中は自動実行中のテーマだけを元の並びで出し、件数が追従する', (tester) async {
    final service = await _pump(tester);
    expect(_shownCards(tester), ['1', '2', '5']);
    expect(find.textContaining('件中'), findsNothing);

    await _setStatus(tester, ExecStatusFilter.running);
    expect(_shownCards(tester), ['1', '2'], reason: '一時停止中の 5 は出さない');
    expect(find.text('3件中2件'), findsOneWidget); // 自動実行（開発テーマ3件中2件）
    expect(find.byKey(const ValueKey('auto-run-no-match')), findsNothing);

    // 並び順を変えてもカードの並びは変わらない
    _container.read(execFilterProvider.notifier).state =
        const ExecFilter(status: ExecStatusFilter.running, sort: ExecSort.oldest);
    await _settle(tester);
    expect(_shownCards(tester), ['1', '2']);

    await _setStatus(tester, ExecStatusFilter.all);
    expect(_shownCards(tester), ['1', '2', '5']);
    expect(service.calls, isEmpty, reason: '絞り込みは自動実行の操作をしない');
  });

  testWidgets('状態＝入力待ちは現在のタスクが入力待ちの自動実行テーマだけを出す', (tester) async {
    await _pump(tester);

    await _setStatus(tester, ExecStatusFilter.waitingForInput);
    expect(_shownCards(tester), ['1']);
    expect(find.text('3件中1件'), findsOneWidget);
  });

  testWidgets('現在のタスクが実行中リストに無ければ入力待ちに数えず、空表示を出す', (tester) async {
    await _pump(tester, executing: [_exec('99', waiting: true)]);

    await _setStatus(tester, ExecStatusFilter.waitingForInput);
    expect(_shownCards(tester), isEmpty);
    expect(find.byKey(const ValueKey('auto-run-no-match')), findsOneWidget);
    expect(find.text('条件に合うテーマはありません'), findsOneWidget);
    expect(find.text('3件中0件'), findsOneWidget);
  });
}
