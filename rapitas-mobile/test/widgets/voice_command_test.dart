import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/backlog.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/backlog_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/approval_service.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';
import 'package:rapitas_mobile/services/category_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';
import 'package:rapitas_mobile/widgets/voice_input_sheet.dart';
import 'package:rapitas_mobile/widgets/voice_mode_host.dart';

/// 聞き取りの偽物。テストから途中結果・終わりを流し込む
class _FakeDictation implements DictationService {
  int starts = 0;
  int cancels = 0;
  void Function(String words)? _onWords;
  void Function(DictationEnd end)? _onEnd;

  bool get active => _onEnd != null;

  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async {
    starts++;
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

  /// 何も言わずに聞き取りが終わった（無音での自動終了）
  void silence() {
    final end = _onEnd!;
    _onWords = null;
    _onEnd = null;
    end(DictationEnd.completed);
  }

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {
    cancels++;
    _onWords = null;
    _onEnd = null;
  }
}

class _FakeApprovals implements ApprovalService {
  final List<ApprovalRequest> items;
  final List<String> approved = [];
  final List<(String, String?)> rejected = [];

  _FakeApprovals(this.items);

  @override
  Future<List<ApprovalRequest>> getApprovals() async => items;

  @override
  Future<void> approve(String id) async => approved.add(id);

  @override
  Future<void> reject(String id, {String? reason}) async => rejected.add((id, reason));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeTasks implements TaskService {
  final List<Task> tasks;
  final List<Map<String, dynamic>> created = [];

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
      tasks
          .where((t) => status == null || t.status == status)
          .where((t) => priority == null || t.priority == priority)
          .toList();

  @override
  Future<List<Task>> searchTasks(String query) async =>
      tasks.where((t) => t.title.contains(query)).toList();

  @override
  Future<Task> createTask(Map<String, dynamic> data) async {
    created.add(data);
    return _task('99', data['title'] as String);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeAgent implements AgentService {
  final List<String> executed = [];
  final List<String> stopped = [];
  List<ExecutingTask> executing = const [];

  @override
  Future<TaskExecutionStart> executeTask(String taskId) async {
    executed.add(taskId);
    return TaskExecutionStart(taskId: taskId, status: 'running');
  }

  @override
  Future<void> stopTaskExecution(String taskId) async => stopped.add(taskId);

  @override
  Future<List<ExecutingTask>> getExecutingTasks() async => executing;

  @override
  Future<List<ResumableExecution>> getResumableExecutions() async => const [];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeBacklog implements BacklogService {
  final List<Hypothesis> hypotheses;
  final List<(String, String)> statusUpdates = [];
  final List<String> deletedHypotheses = [];

  /// 設定すると、一覧の取得がこれの完了まで止まる（取得中のキャンセルの確認用）
  Completer<void>? gate;

  _FakeBacklog(this.hypotheses);

  @override
  Future<List<Hypothesis>> getHypotheses() async {
    final g = gate;
    if (g != null) await g.future;
    return hypotheses;
  }

  @override
  Future<void> updateHypothesisStatus(String id, String status) async => statusUpdates.add((id, status));

  @override
  Future<void> deleteHypothesis(String id) async => deletedHypotheses.add(id);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => [_devTheme, _plainTheme];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// カテゴリ一覧・☆ カテゴリ（タスク一覧の初期選択が読む）。実通信させないための空の CategoryService
class _FakeCategories implements CategoryService {
  @override
  Future<List<TaskCategory>> getCategories() async => const [];

  @override
  Future<String?> getDefaultCategoryId() async => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final _devTheme = TaskTheme(id: '10', name: '開発', isDevelopment: true, workingDirectory: '/work');
final _plainTheme = TaskTheme(id: '11', name: '英語学習');

Task _task(String id, String title, {TaskTheme? theme, String status = 'todo'}) => Task(
      id: id,
      title: title,
      status: status,
      theme: theme,
      themeId: theme?.id,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

ApprovalRequest _approval(String id, String title, {String status = 'pending'}) =>
    ApprovalRequest(id: id, title: title, status: status, createdAt: DateTime(2026, 11, 9));

Hypothesis _hypothesis(String id, String statement) => Hypothesis(
      id: id,
      statement: statement,
      rationale: '',
      domain: '',
      status: 'open',
      confidence: 0.5,
    );

/// ラピへの送信を記録する（通信はしない）
class _FakeRapiChat extends RapiChatNotifier {
  final List<String> sent = [];

  @override
  Future<void> send() async {
    final text = state.input.trim();
    if (text.isEmpty) return;
    sent.add(text);
    state = state.copyWith(input: '');
  }
}

void main() {
  late _FakeDictation dictation;
  late _FakeRapiChat rapiChat;
  late _FakeApprovals approvals;
  late _FakeTasks tasks;
  late _FakeAgent agent;
  late _FakeBacklog backlog;
  late GoRouter router;
  late ProviderContainer container;
  late VoiceRouteTracker tracker;

  Future<void> pumpApp(
    WidgetTester tester,
    String initialLocation, {
    List<ApprovalRequest> approvalItems = const [],
    List<Task> taskItems = const [],
    List<Hypothesis> hypothesisItems = const [],
  }) async {
    // タスク一覧の初期選択がテーマの記憶を読むので、保存先を空のモックにしておく
    SharedPreferences.setMockInitialValues({});
    dictation = _FakeDictation();
    approvals = _FakeApprovals(approvalItems);
    tasks = _FakeTasks(taskItems);
    agent = _FakeAgent();
    backlog = _FakeBacklog(hypothesisItems);
    rapiChat = _FakeRapiChat();
    tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: initialLocation);
    container = ProviderContainer(overrides: [
      dictationServiceProvider.overrideWithValue(dictation),
      approvalServiceProvider.overrideWithValue(approvals),
      taskServiceProvider.overrideWithValue(tasks),
      agentServiceProvider.overrideWithValue(agent),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      categoryServiceProvider.overrideWithValue(_FakeCategories()),
      backlogServiceProvider.overrideWithValue(backlog),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
      rapiChatProvider.overrideWith(() => rapiChat),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pumpAndSettle();
  }

  /// シートは聞き取り中の表示が点滅し続けるので pumpAndSettle は使わず、時間を進めて待つ
  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  /// コマンドシートを開く（音声ボタンは廃止したので、聞き取り表示のタップと同じ口から直接開く）
  Future<void> openSheet(WidgetTester tester) async {
    final navigatorContext = router.routerDelegate.navigatorKey.currentContext!;
    final ui = AppVoiceUi(
      router: router,
      messenger: ScaffoldMessenger.of(navigatorContext),
      tracker: tracker,
    );
    VoiceInputSheet.show(navigatorContext, path: router.state.uri.path, ui: ui);
    await settle(tester);
    expect(dictation.active, isTrue, reason: '開くと聞き取りを始める');
  }

  Future<void> say(WidgetTester tester, String words) async {
    expect(dictation.active, isTrue, reason: '「$words」の前に聞き取りが始まっていない');
    dictation.say(words);
    await settle(tester);
  }

  /// 成功後の自動クローズ・スナックバーまで進める
  Future<void> finish(WidgetTester tester) async {
    await settle(tester, 20);
  }

  String location() => router.state.uri.path;

  group('入口', () {
    testWidgets('左下の音声ボタンは無い（音声操作モードがオフなら聞き取り表示も出ない）', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      expect(find.byKey(const ValueKey('voice-command-fab')), findsNothing);
      expect(find.byKey(const ValueKey('voice-mode-indicator')), findsNothing);
      expect(find.byIcon(Icons.settings_voice), findsNothing);
      // タスク画面の右下の作成ボタンはそのまま
      expect(find.widgetWithIcon(FloatingActionButton, Icons.add), findsOneWidget);
    });
  });

  group('移動', () {
    testWidgets('声でタブを移動する（解釈を見せてからシートを閉じて移動）', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      expect(find.text('音声コマンド'), findsOneWidget);

      dictation.say('タスクを開いて');
      await tester.pump();
      expect(find.text('画面の移動：タスク'), findsOneWidget);
      expect(location(), '/approvals');

      await finish(tester);
      expect(location(), '/tasks');
      expect(find.text('タスクを開きました'), findsOneWidget); // スナックバーに残る
      expect(find.text('音声コマンド'), findsNothing); // シートは閉じた
    });

    testWidgets('ドロワーの画面を開き、「戻る」で戻る', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, '仮説を開いて');
      await finish(tester);
      expect(location(), '/hypotheses');

      await openSheet(tester);
      await say(tester, '戻る');
      await finish(tester);
      expect(location(), '/approvals');
    });

    testWidgets('絞り込みは タスク画面へ移って適用する', (tester) async {
      await pumpApp(tester, '/approvals', taskItems: [_task('1', '資料作成', status: 'in-progress')]);
      await openSheet(tester);
      await say(tester, 'フィルタ 進行中');
      await finish(tester);
      expect(location(), '/tasks');
      expect(container.read(taskFilterProvider).status, 'in-progress');
      expect(find.text('ステータス：進行中'), findsOneWidget);
    });

    testWidgets('「フィルタを解除」はステータス・優先度だけ外し、テーマは残す（テーマは常に選択）', (tester) async {
      await pumpApp(tester, '/approvals', taskItems: [_task('1', '資料作成', status: 'done')]);
      container.read(taskFilterProvider.notifier).state =
          const TaskFilter(themeId: '11', status: 'done', priority: 'high');
      await openSheet(tester);
      await say(tester, 'フィルタを解除');
      await finish(tester);
      expect(location(), '/tasks');
      expect(container.read(taskFilterProvider), const TaskFilter(themeId: '11'));
      expect(find.text('ステータスと優先度の絞り込みを解除しました（テーマはそのままです）'), findsOneWidget);
    });
  });

  group('承認', () {
    final items = [_approval('1', 'ログイン画面の変更'), _approval('2', 'API の追加')];

    testWidgets('番号で対象を指定し、声で「はい」と答えて承認する', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, '2番目を承認');

      expect(find.text('確認'), findsOneWidget);
      expect(find.text('「API の追加」を承認しますか？'), findsOneWidget);
      expect(find.text('2番目の「API の追加」を対象にします'), findsOneWidget);
      expect(approvals.approved, isEmpty, reason: '確認の前には承認しない');

      await say(tester, 'はい');
      expect(approvals.approved, ['2']);
      expect(find.text('「API の追加」を承認しました'), findsWidgets);
      await finish(tester);
      expect(find.text('確認'), findsNothing);
    });

    testWidgets('「いいえ」なら承認しない', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, 'ログインを承認');
      expect(find.text('「ログイン画面の変更」を承認しますか？'), findsOneWidget);
      await say(tester, 'いいえ');
      expect(find.text('やめました'), findsOneWidget);
      await finish(tester);
      expect(approvals.approved, isEmpty);
    });

    testWidgets('指定がなければ先頭を対象にし、その旨を出してから確認する（タップでも答えられる）', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, '承認');
      expect(find.text('対象の指定がないので、先頭の「ログイン画面の変更」を対象にします'), findsOneWidget);
      expect(find.text('「ログイン画面の変更」を承認しますか？'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('voice-yes')));
      await settle(tester);
      expect(approvals.approved, ['1']);
      await finish(tester);
    });

    testWidgets('確認で何も言わなかったら、前の文を答えに使わず聞き直しを待つ', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, '2番目を承認');
      dictation.silence();
      await settle(tester);
      expect(approvals.approved, isEmpty);
      expect(find.text('声を聞き取れませんでした'), findsOneWidget);
      expect(find.text('2番目を承認'), findsOneWidget, reason: '認識した文は残す');

      await tester.tap(find.byKey(const ValueKey('voice-again')));
      await settle(tester);
      expect(find.text('「API の追加」を承認しますか？'), findsOneWidget);
      await say(tester, 'はい');
      expect(approvals.approved, ['2']);
      await finish(tester);
    });

    testWidgets('却下の理由は発話から付ける', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, '1番目を却下 理由はテスト不足');
      expect(find.textContaining('理由：テスト不足'), findsOneWidget);
      await say(tester, 'はい');
      expect(approvals.rejected, [('1', 'テスト不足')]);
      await finish(tester);
    });
  });

  group('実行', () {
    final taskItems = [
      _task('1', 'ログイン画面の実装', theme: _devTheme),
      _task('2', 'ログの整理', theme: _plainTheme), // 実行できない（開発テーマでない）
      _task('3', 'ログアウト処理', theme: _devTheme),
    ];

    testWidgets('タスク名で指定して、確認のうえ実行を始める', (tester) async {
      await pumpApp(tester, '/executions', taskItems: taskItems);
      await openSheet(tester);
      await say(tester, 'ログイン画面を実行して');
      expect(find.text('「ログイン画面の実装」をAIエージェントで実行しますか？'), findsOneWidget);
      expect(agent.executed, isEmpty);

      await say(tester, 'お願いします');
      expect(agent.executed, ['1']);
      expect(find.text('「ログイン画面の実装」の実行を開始しました'), findsWidgets);
      await finish(tester);
    });

    testWidgets('複数に当たったら番号で選ばせる', (tester) async {
      await pumpApp(tester, '/executions', taskItems: taskItems);
      await openSheet(tester);
      await say(tester, 'ログを実行');
      // 実行できるタスクだけが候補（「ログの整理」は出ない）
      expect(find.text('対象を選んでください'), findsOneWidget);
      expect(find.text('ログイン画面の実装'), findsOneWidget);
      expect(find.text('ログアウト処理'), findsOneWidget);
      expect(find.text('ログの整理'), findsNothing);

      await say(tester, '2番');
      expect(find.text('「ログアウト処理」をAIエージェントで実行しますか？'), findsOneWidget);
      await say(tester, 'はい');
      expect(agent.executed, ['3']);
      await finish(tester);
    });

    testWidgets('途中の「キャンセル」で止める', (tester) async {
      await pumpApp(tester, '/executions', taskItems: taskItems);
      await openSheet(tester);
      await say(tester, '実行');
      expect(find.textContaining('先頭の「ログイン画面の実装」'), findsOneWidget);
      await say(tester, 'キャンセル');
      expect(find.text('やめました'), findsOneWidget);
      await finish(tester);
      expect(agent.executed, isEmpty);
    });

    testWidgets('実行中のタスクを番号で停止する', (tester) async {
      await pumpApp(tester, '/executions', taskItems: taskItems);
      agent.executing = const [
        ExecutingTask(executionId: 'e1', sessionId: 's1', taskId: '3', executionStatus: 'running'),
      ];
      container.invalidate(executingTasksProvider);
      await settle(tester);
      await openSheet(tester);
      await say(tester, '1番目を停止');
      expect(find.text('「ログアウト処理」の実行を停止しますか？'), findsOneWidget);
      await say(tester, 'はい');
      expect(agent.stopped, ['3']);
      await finish(tester);
    });
  });

  group('当たらない発話', () {
    testWidgets('タスクは作らず、認識した文とラピへ送る選択肢を出す', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await openSheet(tester);
      await say(tester, '明日の会議の資料を作る');

      expect(find.text('理解できませんでした'), findsOneWidget);
      expect(find.text('コマンドとして理解できませんでした'), findsOneWidget);
      expect(find.text('明日の会議の資料を作る'), findsOneWidget); // 認識した文
      expect(find.byKey(const ValueKey('voice-send-rapi')), findsOneWidget);
      expect(tasks.created, isEmpty);

      await say(tester, 'いいえ');
      await finish(tester);
      expect(find.text('理解できませんでした'), findsNothing);
      expect(tasks.created, isEmpty);
    });

    testWidgets('続けて話せば、そのままコマンドとして読む', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await openSheet(tester);
      await say(tester, 'あいうえお');
      expect(find.text('理解できませんでした'), findsOneWidget);
      await say(tester, '承認を開いて');
      await finish(tester);
      expect(location(), '/approvals');
    });

    // 「ラピに送るか」への答え：明確な肯定か、送る指示として完結した文だけ送る
    for (final reply in ['送信は不要です', '送るのはやめて', 'ラピには送らないで']) {
      testWidgets('「$reply」では送らない', (tester) async {
        await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
        await openSheet(tester);
        await say(tester, '明日の会議の資料を作る');
        expect(find.text('理解できませんでした'), findsOneWidget);
        await say(tester, reply);
        await finish(tester);
        expect(rapiChat.sent, isEmpty);
        expect(location(), '/tasks');
      });
    }

    for (final reply in ['ラピに送って', '送って', 'はい']) {
      testWidgets('「$reply」で元の文を送る', (tester) async {
        await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
        await openSheet(tester);
        await say(tester, '明日の会議の資料を作る');
        await say(tester, reply);
        await finish(tester);
        expect(rapiChat.sent, ['明日の会議の資料を作る']);
        expect(location(), '/rapi');
      });
    }

    testWidgets('「ラピに送る」ボタンで送る', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await openSheet(tester);
      await say(tester, '明日の会議の資料を作る');
      await tester.tap(find.byKey(const ValueKey('voice-send-rapi')));
      await finish(tester);
      expect(rapiChat.sent, ['明日の会議の資料を作る']);
    });

    testWidgets('どちらとも取れない答えは元の文を残して聞き直し、その後の「はい」で元の文を送る', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await openSheet(tester);
      await say(tester, '明日の会議の資料を作る');
      await say(tester, '送信は不要です');
      expect(find.text('理解できませんでした'), findsOneWidget);
      expect(find.text('ラピに送るなら「はい」、送らないなら「いいえ」と答えてください'), findsOneWidget);
      expect(rapiChat.sent, isEmpty);
      await say(tester, 'はい');
      await finish(tester);
      expect(rapiChat.sent, ['明日の会議の資料を作る']);
    });

    testWidgets('どちらとも取れない答えが3回続けばやめる（送らない）', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await openSheet(tester);
      await say(tester, '明日の会議の資料を作る');
      await say(tester, '送信は不要です');
      await say(tester, 'えーと');
      await say(tester, 'うーん');
      expect(find.text('やめました'), findsOneWidget);
      await finish(tester);
      expect(rapiChat.sent, isEmpty);
    });
  });

  group('タスク作成', () {
    testWidgets('タイトル → テーマ → 優先度を順に聞いて作る（「なし」で飛ばせる）', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await openSheet(tester);
      await say(tester, 'タスクを作成');
      expect(find.text('タスクのタイトルを話してください'), findsOneWidget);
      await say(tester, '週報を書く');
      expect(find.textContaining('テーマを話してください'), findsOneWidget);
      expect(find.text('英語学習'), findsOneWidget); // 候補を番号つきで出す
      await say(tester, '英語');
      expect(find.textContaining('優先度を話してください'), findsOneWidget);
      await say(tester, 'なし');

      expect(tasks.created, [
        {'title': '週報を書く', 'priority': 'medium', 'themeId': 11},
      ]);
      expect(find.text('タスク「週報を書く」を作成しました'), findsWidgets);
      await finish(tester);
    });
  });

  group('ヘルプ', () {
    testWidgets('その画面で使えるコマンドを出す', (tester) async {
      await pumpApp(tester, '/approvals');
      await openSheet(tester);
      await say(tester, 'ヘルプ');
      expect(find.text('承認で使えるコマンド'), findsOneWidget);
      expect(find.text('「承認」「2番目を承認」「◯◯を承認」（確認あり）'), findsOneWidget);
      // 「閉じる」でこのシートだけ閉じる
      await say(tester, '閉じる');
      await finish(tester);
      expect(find.text('承認で使えるコマンド'), findsNothing);
      expect(location(), '/approvals');
    });
  });
  group('確認での否定', () {
    final items = [_approval('1', 'ログイン画面の変更'), _approval('2', 'API の追加')];

    testWidgets('「承認しません」なら承認しない', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, '2番目を承認');
      expect(find.text('「API の追加」を承認しますか？'), findsOneWidget);
      await say(tester, '承認しません');
      expect(find.text('やめました'), findsOneWidget);
      await finish(tester);
      expect(approvals.approved, isEmpty);
    });

    testWidgets('「実行しないで」なら実行しない', (tester) async {
      await pumpApp(tester, '/executions', taskItems: [_task('1', 'ログイン画面の実装', theme: _devTheme)]);
      await openSheet(tester);
      await say(tester, 'ログイン画面を実行して');
      expect(find.text('「ログイン画面の実装」をAIエージェントで実行しますか？'), findsOneWidget);
      await say(tester, '実行しないで');
      expect(find.text('やめました'), findsOneWidget);
      await finish(tester);
      expect(agent.executed, isEmpty);
    });

    testWidgets('「削除しないで」なら削除しない', (tester) async {
      await pumpApp(tester, '/hypotheses',
          hypothesisItems: [_hypothesis('h1', 'A案のほうが速い'), _hypothesis('h2', 'B案のほうが安い')]);
      await openSheet(tester);
      await say(tester, '2番目を削除');
      expect(find.textContaining('「B案のほうが安い」を削除しますか？'), findsOneWidget);
      await say(tester, '削除しないで');
      expect(find.text('やめました'), findsOneWidget);
      await finish(tester);
      expect(backlog.deletedHypotheses, isEmpty);
    });

    testWidgets('どちらとも取れない答えは聞き直し、操作しない', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: items);
      await openSheet(tester);
      await say(tester, '2番目を承認');
      await say(tester, '承認フロー');
      expect(approvals.approved, isEmpty);
      expect(find.textContaining('「はい」か「いいえ」で答えてください'), findsOneWidget);
      await say(tester, 'いいえ');
      await finish(tester);
      expect(approvals.approved, isEmpty);
    });
  });

  group('取得中のキャンセル', () {
    testWidgets('一覧の取得中にキャンセルしたら、取得が終わっても変更しない', (tester) async {
      await pumpApp(tester, '/hypotheses',
          hypothesisItems: [_hypothesis('h1', 'A案のほうが速い'), _hypothesis('h2', 'B案のほうが安い')]);
      // ここからの取得は gate が開くまで止まる
      final gate = Completer<void>();
      backlog.gate = gate;
      container.invalidate(hypothesisListProvider);
      await settle(tester);

      await openSheet(tester);
      // 番号を指定した状態変更は確認なしで進む操作
      await say(tester, '2番目を立証にする');
      expect(find.text('仮説を確認しています…'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('voice-close')));
      await settle(tester);
      expect(find.text('音声コマンド'), findsNothing);

      gate.complete();
      await finish(tester);
      expect(backlog.statusUpdates, isEmpty, reason: '閉じた後は変更を始めない');
    });

    testWidgets('（対照）取得を待ってそのまま進めれば変更する', (tester) async {
      await pumpApp(tester, '/hypotheses',
          hypothesisItems: [_hypothesis('h1', 'A案のほうが速い'), _hypothesis('h2', 'B案のほうが安い')]);
      final gate = Completer<void>();
      backlog.gate = gate;
      container.invalidate(hypothesisListProvider);
      await settle(tester);

      await openSheet(tester);
      await say(tester, '2番目を立証にする');
      gate.complete();
      await finish(tester);
      expect(backlog.statusUpdates, [('h2', 'supported')]);
    });
  });

  group('承認の番号は画面の並び', () {
    final mixed = [
      _approval('a', '承認済みの変更', status: 'approved'),
      _approval('b', 'ログイン画面の変更'),
      _approval('c', 'API の追加'),
    ];

    testWidgets('「2番目」は画面の2番目（保留中のもの）を指す', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: mixed);
      // 画面には処理済みも含めて全件が出ている
      expect(find.text('承認済みの変更'), findsOneWidget);
      await openSheet(tester);
      await say(tester, '2番目を承認');
      expect(find.text('「ログイン画面の変更」を承認しますか？'), findsOneWidget);
      await say(tester, 'はい');
      expect(approvals.approved, ['b']);
      await finish(tester);
    });

    testWidgets('処理済みの行を番号で指したら操作せず、案内を出す', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: mixed);
      await openSheet(tester);
      await say(tester, '1番目を承認');
      expect(find.textContaining('その項目は既に処理済みです'), findsOneWidget);
      expect(find.textContaining('承認しますか？'), findsNothing);
      await finish(tester);
      expect(approvals.approved, isEmpty);
    });

    testWidgets('処理済みの行を名前で指しても操作しない（却下も同じ）', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: mixed);
      await openSheet(tester);
      await say(tester, '承認済みの変更を却下');
      expect(find.textContaining('その項目は既に処理済みです'), findsOneWidget);
      await finish(tester);
      expect(approvals.rejected, isEmpty);
    });

    testWidgets('指定がなければ先頭の保留中のものを対象にする', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: mixed);
      await openSheet(tester);
      await say(tester, '承認');
      expect(find.text('「ログイン画面の変更」を承認しますか？'), findsOneWidget);
      await say(tester, 'はい');
      expect(approvals.approved, ['b']);
      await finish(tester);
    });
  });
}
