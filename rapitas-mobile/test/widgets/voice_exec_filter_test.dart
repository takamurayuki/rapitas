// 実行画面の音声操作（「1番目を停止」「1番目を再開」）が、表示中（絞り込み・並び替え後）の一覧で番号を数えること。
//
// 偽物の構成は voice_command_test.dart と同じ（そちらは 783 行あるので、このテストはファイルを分けた）。
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_auto_run_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/category_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';
import 'package:rapitas_mobile/widgets/voice_input_sheet.dart';
import 'package:rapitas_mobile/widgets/voice_mode_host.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

class _FakeDictation implements DictationService {
  void Function(String words)? _onWords;
  void Function(DictationEnd end)? _onEnd;

  bool get active => _onEnd != null;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    _onWords = onWords;
    _onEnd = onEnd;
    return null;
  }

  void say(String words) {
    _onWords!(words);
    final end = _onEnd!;
    _onWords = null;
    _onEnd = null;
    end(DictationEnd.completed);
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {
    _onWords = null;
    _onEnd = null;
  }
}

class _FakeTasks implements TaskService {
  final List<Task> tasks;

  _FakeTasks(this.tasks);

  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async =>
      tasks.where((t) => status == null || t.status == status).toList();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAgent implements AgentService {
  final List<String> stopped = [];
  final List<String> resumed = [];
  final List<ExecutingTask> executing;
  final List<ResumableExecution> resumable;

  _FakeAgent(this.executing, this.resumable);

  @override
  Future<void> stopTaskExecution(String taskId) async => stopped.add(taskId);

  @override
  Future<void> resumeExecution(String executionId) async => resumed.add(executionId);

  @override
  Future<List<ExecutingTask>> getExecutingTasks() async => executing;

  @override
  Future<List<ResumableExecution>> getResumableExecutions() async => resumable;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => [_devTheme, _plainTheme];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeCategories implements CategoryService {
  @override
  Future<List<TaskCategory>> getCategories() async => const [];

  @override
  Future<String?> getDefaultCategoryId() async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeRapiChat extends RapiChatNotifier {
  @override
  Future<void> send() async {}
}

final _devTheme = TaskTheme(id: '10', name: '【ダミー】開発', isDevelopment: true, workingDirectory: '/work');
final _plainTheme = TaskTheme(id: '11', name: '【ダミー】英語学習');

Task _task(String id, String title, TaskTheme theme) => Task(
      id: id,
      title: title,
      theme: theme,
      themeId: theme.id,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

final _tasks = [
  _task('1', '【ダミー】ログイン画面の実装', _devTheme),
  _task('3', '【ダミー】ログアウト処理', _devTheme),
  _task('4', '【ダミー】単語帳の整理', _plainTheme),
];

DateTime _at(int hour) => DateTime(2026, 11, 17, hour);

// API の並びは 1 → 3 → 4。表示（開発テーマ・新しい順）は 3 → 1
final _executing = [
  ExecutingTask(executionId: 'e1', sessionId: 's1', taskId: '1', executionStatus: 'running', startedAt: _at(9)),
  ExecutingTask(executionId: 'e3', sessionId: 's3', taskId: '3', executionStatus: 'running', startedAt: _at(11)),
  ExecutingTask(executionId: 'e4', sessionId: 's4', taskId: '4', executionStatus: 'running', startedAt: _at(10)),
];

// API の並びは r1 → r4 → r3。表示（開発テーマ・古い順）は r3 → r1
final _resumable = [
  ResumableExecution(id: 'r1', taskId: '1', status: 'interrupted', canResume: true, startedAt: _at(9)),
  ResumableExecution(id: 'r4', taskId: '4', status: 'interrupted', canResume: true, startedAt: _at(7)),
  ResumableExecution(id: 'r3', taskId: '3', status: 'interrupted', canResume: true, startedAt: _at(8)),
];

void main() {
  late _FakeDictation dictation;
  late _FakeAgent agent;
  late GoRouter router;
  late ProviderContainer container;
  late VoiceRouteTracker tracker;

  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pumpApp(WidgetTester tester, String location, ExecFilter filter) async {
    SharedPreferences.setMockInitialValues({});
    dictation = _FakeDictation();
    agent = _FakeAgent(_executing, _resumable);
    tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: location);
    container = ProviderContainer(overrides: [
      dictationServiceProvider.overrideWithValue(dictation),
      taskServiceProvider.overrideWithValue(_FakeTasks(_tasks)),
      agentServiceProvider.overrideWithValue(agent),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      themeAutoRunServiceProvider.overrideWithValue(FakeThemeAutoRunService({})),
      categoryServiceProvider.overrideWithValue(_FakeCategories()),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
      rapiChatProvider.overrideWith(() => _FakeRapiChat()),
    ]);
    addTearDown(container.dispose);
    container.read(execFilterProvider.notifier).state = filter;
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ));
    // 実行中タイルのスピナーが止まらないので pumpAndSettle は使わない
    await settle(tester, 10);
  }

  Future<void> openSheet(WidgetTester tester) async {
    final navigatorContext = router.routerDelegate.navigatorKey.currentContext!;
    final ui = AppVoiceUi(router: router, messenger: ScaffoldMessenger.of(navigatorContext), tracker: tracker);
    VoiceInputSheet.show(navigatorContext, path: router.state.uri.path, ui: ui);
    await settle(tester);
    expect(dictation.active, isTrue);
  }

  Future<void> say(WidgetTester tester, String words) async {
    expect(dictation.active, isTrue, reason: '「$words」の前に聞き取りが始まっていない');
    dictation.say(words);
    await settle(tester);
  }

  /// 画面上で上から何番目に出ているか（タイトルの縦位置の順）
  List<String> shownOrder(WidgetTester tester, List<String> titles) {
    final visible = titles.where((t) => find.text(t).evaluate().isNotEmpty).toList();
    visible.sort((a, b) => tester.getTopLeft(find.text(a).first).dy.compareTo(tester.getTopLeft(find.text(b).first).dy));
    return visible;
  }

  testWidgets('実行画面の「1番目を停止」は、テーマで絞って新しい順に並べた表示の1番目を指す', (tester) async {
    await pumpApp(tester, '/executions', const ExecFilter(themeIds: {'10'}));
    expect(shownOrder(tester, [for (final t in _tasks) t.title]), ['【ダミー】ログアウト処理', '【ダミー】ログイン画面の実装']);

    await openSheet(tester);
    await say(tester, '1番目を停止');
    expect(find.text('「【ダミー】ログアウト処理」の実行を停止しますか？'), findsOneWidget);
    await say(tester, 'はい');
    expect(agent.stopped, ['3']);
    await settle(tester, 20);
  });

  testWidgets('表示に無い3番目は指せない（絞り込みで隠れた実行は止めない）', (tester) async {
    await pumpApp(tester, '/executions', const ExecFilter(themeIds: {'10'}));
    await openSheet(tester);
    await say(tester, '3番目を停止');
    expect(find.textContaining('3番目の実行中のタスクはありません（2件）'), findsOneWidget);
    expect(agent.stopped, isEmpty);
    await settle(tester, 20);
  });

  testWidgets('実行画面の「1番目を再開」は、絞り込み・古い順の表示の1番目を指す', (tester) async {
    await pumpApp(tester, '/executions', const ExecFilter(themeIds: {'10'}, sort: ExecSort.oldest));
    await openSheet(tester);
    await say(tester, '1番目を再開');
    expect(find.text('「【ダミー】ログアウト処理」の実行を再開しますか？'), findsOneWidget);
    await say(tester, 'はい');
    expect(agent.resumed, ['r3']);
    await settle(tester, 20);
  });
}
