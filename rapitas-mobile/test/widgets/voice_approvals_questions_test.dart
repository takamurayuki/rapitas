// 承認ページに質問カードが混在していても、音声の「N番目を承認」は承認リクエストだけで番号を数えること（nav80）。
//
// 偽物の構成は voice_command_test.dart と同じ（そちらは 783 行あるので、このテストはファイルを分けた）。
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_auto_run_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/approval_service.dart';
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

class _FakeApprovals implements ApprovalService {
  final List<ApprovalRequest> items;
  final List<String> approved = [];

  _FakeApprovals(this.items);

  @override
  Future<List<ApprovalRequest>> getApprovals() async => items;

  @override
  Future<void> approve(String id) async => approved.add(id);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAgent implements AgentService {
  final List<ExecutingTask> executing;

  _FakeAgent(this.executing);

  @override
  Future<List<ExecutingTask>> getExecutingTasks() async => executing;

  @override
  Future<List<ResumableExecution>> getResumableExecutions() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTasks implements TaskService {
  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async =>
      const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => const [];

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

ApprovalRequest _approval(String id, String title) =>
    ApprovalRequest(id: id, title: title, status: 'pending', createdAt: DateTime(2026, 11, 19, 9));

ExecutingTask _question(String id, String question) => ExecutingTask(
      executionId: 'e$id',
      sessionId: 's$id',
      taskId: id,
      executionStatus: 'waiting_for_input',
      startedAt: DateTime(2026, 11, 19, 8),
      question: question,
    );

void main() {
  late _FakeDictation dictation;
  late _FakeApprovals approvals;
  late GoRouter router;
  late VoiceRouteTracker tracker;

  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pumpApp(WidgetTester tester, List<ApprovalRequest> items, List<ExecutingTask> executing) async {
    SharedPreferences.setMockInitialValues({});
    dictation = _FakeDictation();
    approvals = _FakeApprovals(items);
    tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: '/approvals');
    final container = ProviderContainer(overrides: [
      dictationServiceProvider.overrideWithValue(dictation),
      approvalServiceProvider.overrideWithValue(approvals),
      taskServiceProvider.overrideWithValue(_FakeTasks()),
      agentServiceProvider.overrideWithValue(_FakeAgent(executing)),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      themeAutoRunServiceProvider.overrideWithValue(FakeThemeAutoRunService({})),
      categoryServiceProvider.overrideWithValue(_FakeCategories()),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
      rapiChatProvider.overrideWith(() => _FakeRapiChat()),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ));
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

  testWidgets('質問カードが並んでいても「2番目を承認」は2番目の承認リクエストを指す', (tester) async {
    await pumpApp(
      tester,
      [_approval('1', '【ダミー】ログイン画面の変更'), _approval('2', '【ダミー】API の追加')],
      [_question('101', '【ダミー】どちらの案にしますか？')],
    );
    expect(find.text('【ダミー】どちらの案にしますか？'), findsOneWidget, reason: '質問カードが画面に出ている');

    await openSheet(tester);
    await say(tester, '2番目を承認');
    expect(find.text('「【ダミー】API の追加」を承認しますか？'), findsOneWidget);
    await say(tester, 'はい');
    expect(approvals.approved, ['2']);
    await settle(tester, 20);
  });

  testWidgets('承認が1件だけなら、画面で2番目に出ている質問を「2番目を承認」で指さない', (tester) async {
    await pumpApp(
      tester,
      [_approval('1', '【ダミー】ログイン画面の変更')],
      [_question('101', '【ダミー】どちらの案にしますか？')],
    );
    expect(find.text('【ダミー】どちらの案にしますか？'), findsOneWidget);

    await openSheet(tester);
    await say(tester, '2番目を承認');
    expect(find.textContaining('2番目の承認リクエストはありません（1件）'), findsOneWidget);
    expect(approvals.approved, isEmpty);
    await settle(tester, 20);
  });
}
