/// 実行ログの入口2か所（実行画面のタイル、タスク詳細の実行カード）が同じ部品（ExecutionLogPanel）を開くこと。
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/task_detail/task_execution_controls.dart';
import 'package:rapitas_mobile/services/execution_log/execution_log_snapshot.dart';
import 'package:rapitas_mobile/widgets/execution_log/execution_log.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../services/execution_log/execution_log_fixtures.dart';
import '../../support/theme_auto_run_fakes.dart';

const _running = ExecutingTask(executionId: '70', sessionId: '7', taskId: '21', executionStatus: 'running');

final _task = Task(
  id: '21',
  title: '【ダミー】実行中のタスク',
  createdAt: DateTime(2026, 11, 1),
  updatedAt: DateTime(2026, 11, 1),
);

/// 開いた ExecutionLogPanel と、ログを読みに行ったキー
final _requested = <({String taskId, String? executionId})>[];

List<Override> _logOverrides() => [
      taskExecutionLogsProvider.overrideWith((ref, key) async {
        _requested.add(key);
        return ExecutionLogSnapshot.fromJson({'status': 'running', 'logs': claudeHappyPath.sublist(0, 12)});
      }),
      executionLogPollIntervalProvider.overrideWithValue(null),
    ];

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  setUp(_requested.clear);

  testWidgets('実行画面：実行中のタイルをタップすると ExecutionLogPanel（その実行のログ）が開く', (tester) async {
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ...autoRunScreenOverrides(FakeThemeAutoRunService({'1': idleSnapshot('1')}), [dummyThemes.first]),
        executingTasksProvider.overrideWith((ref) async => const [_running]),
        resumableExecutionsProvider.overrideWith((ref) async => const <ResumableExecution>[]),
        taskTitleLookupProvider.overrideWithValue(const {'21': '【ダミー】実行中のタスク'}),
        ..._logOverrides(),
      ],
      child: const MaterialApp(home: AgentExecutionScreen()),
    ));
    await _settle(tester);

    await tester.tap(find.text('【ダミー】実行中のタスク'));
    await _settle(tester);

    final panel = tester.widget<ExecutionLogPanel>(find.byType(ExecutionLogPanel));
    expect((panel.taskId, panel.executionId), ('21', '70'));
    expect(find.byKey(const ValueKey('exec-log-status')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-log-timeline')), findsOneWidget);
  });

  Future<void> pumpCard(WidgetTester tester, {required List<ExecutingTask> executing}) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        executingTasksProvider.overrideWith((ref) async => executing),
        ..._logOverrides(),
      ],
      child: MaterialApp(
        home: Scaffold(body: TaskExecutionInfoCard(task: _task, executing: executing.isNotEmpty)),
      ),
    ));
    await _settle(tester);
    await tester.tap(find.byKey(const ValueKey('task-detail-open-logs')));
    await _settle(tester);
  }

  testWidgets('タスク詳細：実行中なら「実行ログ」で同じ部品がその実行のログを開く', (tester) async {
    await pumpCard(tester, executing: const [_running]);

    final panel = tester.widget<ExecutionLogPanel>(find.byType(ExecutionLogPanel));
    expect((panel.taskId, panel.executionId), ('21', '70'));
    expect(panel.title, '【ダミー】実行中のタスク');
    expect(find.byKey(const ValueKey('exec-log-status')), findsOneWidget);
    expect(find.byKey(const ValueKey('exec-log-timeline')), findsOneWidget);
  });

  testWidgets('タスク詳細：実行中でなければタスクの最新セッションのログを開く', (tester) async {
    await pumpCard(tester, executing: const []);

    final panel = tester.widget<ExecutionLogPanel>(find.byType(ExecutionLogPanel));
    expect(panel.executionId, isNull);
    expect(_requested, contains((taskId: '21', executionId: null)));
  });
}
