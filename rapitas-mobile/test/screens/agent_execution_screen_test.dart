/// Executions screen: no single-task run entry point (FAB / task picker), and
/// the running / resumable lists still stop and resume through AgentService.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

/// 停止・再開を控えるだけの AgentService。単一タスク実行が呼ばれたら [executed] に残る
class _FakeAgent implements AgentService {
  final List<String> stopped = [];
  final List<String> resumed = [];
  final List<String> executed = [];

  @override
  Future<void> stopTaskExecution(String taskId) async => stopped.add(taskId);

  @override
  Future<void> resumeExecution(String executionId) async => resumed.add(executionId);

  @override
  Future<TaskExecutionStart> executeTask(String taskId) async {
    executed.add(taskId);
    return TaskExecutionStart(taskId: taskId, status: 'started');
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

const _running = ExecutingTask(
  executionId: '70',
  sessionId: '7',
  taskId: '21',
  executionStatus: 'running',
);

const _resumable = ResumableExecution(
  id: '55',
  taskId: '22',
  taskTitle: '【ダミー】中断した実行',
  status: 'interrupted',
  canResume: true,
);

Future<_FakeAgent> _pump(
  WidgetTester tester, {
  List<ExecutingTask> executing = const [],
  List<ResumableExecution> resumable = const [],
}) async {
  SharedPreferences.setMockInitialValues({});
  final agent = _FakeAgent();
  await tester.pumpWidget(ProviderScope(
    overrides: [
      ...autoRunScreenOverrides(FakeThemeAutoRunService({'1': idleSnapshot('1')}), [dummyThemes.first]),
      agentServiceProvider.overrideWithValue(agent),
      executingTasksProvider.overrideWith((ref) async => executing),
      resumableExecutionsProvider.overrideWith((ref) async => resumable),
      taskTitleLookupProvider.overrideWithValue(const {'21': '【ダミー】実行中のタスク'}),
    ],
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await _settle(tester);
  return agent;
}

/// 実行中タイルのスピナーは止まらないので pumpAndSettle ではなく一定時間だけ進める
Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  testWidgets('(a) 単一タスク実行の FAB とタスク選択の導線は無い', (tester) async {
    await _pump(tester, executing: const [_running], resumable: const [_resumable]);

    expect(find.byType(FloatingActionButton), findsNothing);
    expect(find.text('タスクを実行'), findsNothing);
    expect(find.text('実行するタスクを選択'), findsNothing);
  });

  testWidgets('実行中タスクの停止は確認のうえ stopTaskExecution を呼ぶ', (tester) async {
    final agent = await _pump(tester, executing: const [_running]);

    expect(find.text('【ダミー】実行中のタスク'), findsOneWidget);
    await tester.tap(find.byTooltip('停止'));
    await _settle(tester);
    expect(find.text('「【ダミー】実行中のタスク」の実行を停止しますか？'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '停止'));
    await _settle(tester);

    expect(agent.stopped, ['21']);
    expect(agent.executed, isEmpty);
    expect(find.text('実行を停止しました'), findsOneWidget);
  });

  testWidgets('再開可能な実行の再開は resumeExecution を呼ぶ', (tester) async {
    final agent = await _pump(tester, resumable: const [_resumable]);

    expect(find.text('【ダミー】中断した実行'), findsOneWidget);
    await tester.tap(find.text('再開'));
    await _settle(tester);

    expect(agent.resumed, ['55']);
    expect(agent.executed, isEmpty);
    expect(find.text('実行を再開しました'), findsOneWidget);
  });

  testWidgets('(c) 実行中が空のときは見出し「実行中」のすぐ下に枠つきの空状態を出す', (tester) async {
    await _pump(tester);

    final empty = find.byKey(const ValueKey('executing-empty'));
    expect(empty, findsOneWidget);
    expect(find.descendant(of: empty, matching: find.byIcon(Icons.play_circle_outline)), findsOneWidget);
    expect(find.descendant(of: empty, matching: find.text('実行中のタスクはありません')), findsOneWidget);
    // 枠のあるブロックとして出す
    final box = tester.widget<Container>(empty);
    expect((box.decoration as BoxDecoration).border, isNotNull);

    // 見出し「実行中」の直下（「再開可能」より上）
    final headingBottom = tester.getBottomLeft(find.text('実行中')).dy;
    final emptyTop = tester.getTopLeft(empty).dy;
    expect(emptyTop, greaterThan(headingBottom));
    expect(emptyTop - headingBottom, lessThan(24));
    expect(emptyTop, lessThan(tester.getTopLeft(find.text('再開可能')).dy));
  });

  testWidgets('実行中のタスクがあるときは空状態を出さない', (tester) async {
    await _pump(tester, executing: const [_running]);

    expect(find.byKey(const ValueKey('executing-empty')), findsNothing);
    expect(find.text('【ダミー】実行中のタスク'), findsOneWidget);
  });
}
