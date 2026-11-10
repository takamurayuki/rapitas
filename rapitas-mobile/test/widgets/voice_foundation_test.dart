import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/notification_model.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/settings_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/services/approval_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/notification_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:rapitas_mobile/services/voice_mode_listener.dart';
import 'package:rapitas_mobile/services/voice_opened_screens.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';
import 'package:rapitas_mobile/widgets/voice_mode_host.dart';
import 'package:rapitas_mobile/widgets/voice_scroll_target.dart';
import 'package:shared_preferences/shared_preferences.dart';

// 音声操作の土台（2026-11-11）：
// - 聞き取り表示の状態の混同を直したこと（準備中／話せます、処理中／回答待ち、シートでの声の受け取り）
// - 共通の「更新」、スクロールの受け口、ドロワー・検索の「閉じる」「戻る」
// - 声で開いた画面・検索では入力欄に自動でフォーカスしない（常時聞き取りを止めない）

/// 端末の聞き取りの偽物。[holdStart] の間は開始が終わらない（「準備中」を見るため）
class _FakeSpeech implements DictationService {
  int starts = 0;
  bool holdStart = false;
  Completer<void>? _gate;
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
    if (holdStart) {
      final gate = _gate = Completer<void>();
      await gate.future;
    }
    return null;
  }

  /// 止めていた開始を終わらせる
  void releaseStart() => _gate?.complete();

  /// 途中経過の文だけ届ける（まだ終わらない）
  void words(String w) => _onWords!(w);

  void say(String w) {
    _onWords!(w);
    end(DictationEnd.completed);
  }

  void end(DictationEnd e) {
    final cb = _onEnd!;
    _onWords = null;
    _onEnd = null;
    cb(e);
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
  int listCalls = 0;

  _FakeTasks(this.tasks);

  @override
  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async {
    listCalls++;
    return tasks;
  }

  @override
  Future<List<Task>> searchTasks(String query) async => tasks.where((t) => t.title.contains(query)).toList();

  @override
  Future<Task> getTask(String id) async => tasks.firstWhere((t) => t.id == id);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 承認の実行を [gate] で止められる偽物（「処理中」を見るため）
class _FakeApprovals implements ApprovalService {
  final List<ApprovalRequest> items;
  Completer<void>? gate;
  final List<String> approved = [];

  _FakeApprovals(this.items);

  @override
  Future<List<ApprovalRequest>> getApprovals() async => items;

  @override
  Future<void> approve(String id) async {
    await gate?.future;
    approved.add(id);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeNotifications implements NotificationService {
  @override
  Future<List<AppNotification>> getNotifications() async => [
        for (var i = 0; i < 20; i++)
          AppNotification(id: '$i', type: 'info', title: '通知 $i', message: '本文', createdAt: DateTime(2026, 11, 10)),
      ];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => [TaskTheme(id: '11', name: '英語学習')];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Task _task(String id, String title) => Task(
      id: id,
      title: title,
      status: 'todo',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

const _restart = Duration(milliseconds: 50);

void main() {
  late _FakeSpeech speech;
  late _FakeTasks tasks;
  late _FakeApprovals approvals;
  late GoRouter router;
  late ProviderContainer container;

  VoiceModeListener listener() => container.read(voiceModeListenerProvider);
  String location() => router.state.uri.path;
  final sheet = find.text('認識した文');

  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pumpApp(
    WidgetTester tester,
    String initialLocation, {
    List<Task> taskItems = const [],
    List<ApprovalRequest> approvalItems = const [],
    bool holdStart = false,
  }) async {
    SharedPreferences.setMockInitialValues({VoiceCommandModeNotifier.prefsKey: true});
    VoiceOpenedScreens.reset();
    speech = _FakeSpeech()..holdStart = holdStart;
    tasks = _FakeTasks(taskItems);
    approvals = _FakeApprovals(approvalItems);
    final tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: initialLocation);
    container = ProviderContainer(overrides: [
      speechDictationProvider.overrideWithValue(speech),
      voicePermissionProvider.overrideWithValue(() async => null),
      voiceModeListenerProvider.overrideWith((ref) => VoiceModeListener(
            coordinator: ref.watch(dictationCoordinatorProvider),
            parser: ref.watch(voiceCommandParserProvider),
            restartDelay: _restart,
            quickEnd: Duration.zero,
          )),
      taskServiceProvider.overrideWithValue(tasks),
      approvalServiceProvider.overrideWithValue(approvals),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      notificationServiceProvider.overrideWithValue(_FakeNotifications()),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: MaterialApp.router(
        routerConfig: router,
        builder: (context, child) => VoiceModeHost(router: router, child: child!),
      ),
    ));
    await settle(tester);
  }

  Future<void> say(WidgetTester tester, String words) async {
    expect(speech.active, isTrue, reason: '「$words」の前に聞き取りが始まっていない');
    speech.say(words);
    await settle(tester);
  }

  void expectBackgroundListening() {
    expect(listener().isListening, isTrue, reason: '常時聞き取りが開いている');
    expect(speech.active, isTrue);
  }

  /// 状態の移り変わりを記録する
  List<VoiceModeStatus> recordStatuses() {
    final seen = <VoiceModeStatus>[];
    void onChange() {
      if (seen.isEmpty || seen.last != listener().status) seen.add(listener().status);
    }

    listener().addListener(onChange);
    addTearDown(() => listener().removeListener(onChange));
    return seen;
  }

  group('聞き取り表示の状態', () {
    testWidgets('開始が終わるまでは「準備中」、開始できたら「話せます」（開始待ちを受付可能と見せない）', (tester) async {
      await pumpApp(tester, '/tasks', holdStart: true);
      expect(speech.starts, 1);
      expect(listener().status, VoiceModeStatus.preparing);
      expect(find.byKey(const ValueKey('voice-mode-dot-preparing')), findsOneWidget);

      speech.releaseStart();
      await settle(tester, 1);
      expect(listener().status, VoiceModeStatus.ready);
      expect(find.byKey(const ValueKey('voice-mode-dot-ready')), findsOneWidget);
    });

    testWidgets('聞き取りが終わって張り直すまでの間は「準備中」、張り直したら「話せます」', (tester) async {
      await pumpApp(tester, '/tasks');
      expect(listener().status, VoiceModeStatus.ready);
      final seen = recordStatuses();
      speech.end(DictationEnd.noSpeech);
      await settle(tester);
      expect(seen, [VoiceModeStatus.preparing, VoiceModeStatus.ready]);
      expectBackgroundListening();
    });

    testWidgets('言葉が届いている間は「声を受け取り中」、届かずに終われば戻る', (tester) async {
      await pumpApp(tester, '/tasks');
      speech.words('たす');
      await settle(tester, 1);
      expect(listener().status, VoiceModeStatus.hearing);
      expect(find.byKey(const ValueKey('voice-mode-dot-hearing')), findsOneWidget);
      expect(find.byIcon(Icons.graphic_eq), findsOneWidget);
    });

    testWidgets('シートが確認を待つ間は「回答待ち」、答えている間は「声を受け取り中」、実行中は「処理中」', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: [
        ApprovalRequest(id: '1', title: 'ログイン画面の変更', status: 'pending', createdAt: DateTime(2026, 11, 9)),
      ]);
      approvals.gate = Completer<void>();
      await say(tester, '承認');
      expect(sheet, findsOneWidget);
      expect(find.text('「ログイン画面の変更」を承認しますか？'), findsOneWidget);
      expect(listener().status, VoiceModeStatus.awaiting, reason: '確認待ちは処理中（回るアイコン）に見せない');
      expect(find.byKey(const ValueKey('voice-mode-dot-awaiting')), findsOneWidget);
      expect(find.byIcon(Icons.help), findsOneWidget);

      // シートの聞き取りに言葉が届いている
      speech.words('は');
      await settle(tester, 1);
      expect(listener().status, VoiceModeStatus.hearing);

      speech.say('はい');
      await settle(tester, 2);
      expect(approvals.approved, isEmpty, reason: '承認の実行を止めている');
      expect(listener().status, VoiceModeStatus.processing);
      expect(find.byKey(const ValueKey('voice-mode-spin')), findsOneWidget);

      approvals.gate!.complete();
      await settle(tester, 25);
      expect(approvals.approved, ['1']);
      expect(sheet, findsNothing);
      expect(listener().status, VoiceModeStatus.ready);
    });
  });

  group('更新', () {
    testWidgets('「更新」でいまの画面を再読み込みする（引っ張って更新と同じ）', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      final before = tasks.listCalls;
      await say(tester, '更新');
      await settle(tester, 10);
      expect(sheet, findsNothing, reason: 'シートを開かずにそのまま実行する');
      expect(find.text('再読み込みしています'), findsOneWidget);
      expect(tasks.listCalls, greaterThan(before));
      expectBackgroundListening();
    });

    for (final path in ['/', '/executions', '/approvals', '/notifications', '/dashboard', '/settings', '/categories', '/themes', '/ideas', '/concerns', '/hypotheses', '/tasks/1']) {
      testWidgets('$path：「更新」が効く', (tester) async {
        await pumpApp(tester, path, taskItems: [_task('1', '資料作成')]);
        await say(tester, '再読み込み');
        expect(find.text('この画面では更新できません'), findsNothing);
        expect(find.text('再読み込みしています'), findsOneWidget);
      });
    }

    testWidgets('入力フォームでは更新しない（入力中の内容を消さない）と伝える', (tester) async {
      await pumpApp(tester, '/ideas/new');
      FocusManager.instance.primaryFocus?.unfocus();
      await settle(tester);
      await say(tester, '更新');
      expect(find.text('この画面では更新できません'), findsOneWidget);
    });
  });

  group('スクロール', () {
    for (final path in ['/', '/tasks/1', '/tasks/new', '/notifications', '/dashboard', '/settings', '/categories', '/themes/new', '/categories/new', '/ideas/new', '/concerns/new']) {
      testWidgets('$path：スクロールの受け口がある', (tester) async {
        await pumpApp(tester, path, taskItems: [_task('1', '資料作成')]);
        // 作成フォームはタップで開いた扱いなので入力欄にフォーカスしている。外してから話す
        FocusManager.instance.primaryFocus?.unfocus();
        await settle(tester);
        await say(tester, '下にスクロール');
        expect(find.text('この画面ではスクロールできません'), findsNothing);
        expectBackgroundListening();
      });
    }

    testWidgets('設定は縦に長いので実際に動く', (tester) async {
      await pumpApp(tester, '/settings');
      final scrollable = find.descendant(of: find.byType(VoiceScrollTarget), matching: find.byType(Scrollable)).first;
      double offset() => tester.state<ScrollableState>(scrollable).position.pixels;
      expect(offset(), 0);
      await say(tester, '下にスクロール');
      expect(offset(), greaterThan(0));
    });

    test('受け口のパスは AppRoutes と同じ形の :id で実際のパスに当たる', () {
      expect(VoiceScrollTarget.matchesPath('/tasks/:id', '/tasks/12'), isTrue);
      expect(VoiceScrollTarget.matchesPath('/tasks/:id/edit', '/tasks/12/edit'), isTrue);
      expect(VoiceScrollTarget.matchesPath('/tasks/:id', '/tasks'), isFalse);
      expect(VoiceScrollTarget.matchesPath('/tasks/:id', '/tasks/12/edit'), isFalse);
      expect(VoiceScrollTarget.matchesPath('/themes/:id/edit', '/categories/3/edit'), isFalse);
      expect(VoiceScrollTarget.matchesPath('/settings', '/settings'), isTrue);
    });
  });

  group('ドロワーと検索を閉じる', () {
    ScaffoldState drawerScaffold(WidgetTester tester) =>
        tester.firstState<ScaffoldState>(find.byWidgetPredicate((w) => w is Scaffold && w.drawer != null));

    for (final words in ['閉じる', '戻る']) {
      testWidgets('「$words」でドロワーを閉じる', (tester) async {
        await pumpApp(tester, '/tasks');
        drawerScaffold(tester).openDrawer();
        await settle(tester);
        expect(drawerScaffold(tester).isDrawerOpen, isTrue);
        await say(tester, words);
        await settle(tester);
        expect(drawerScaffold(tester).isDrawerOpen, isFalse);
        expect(location(), '/tasks');
      });
    }

    testWidgets('声の「検索」では検索欄にフォーカスせず聞き取りを続け、「閉じる」で検索を閉じる', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成'), _task('2', '資料の確認')]);
      await say(tester, '検索 資料');
      expect(find.byTooltip('検索を閉じる'), findsOneWidget);
      expect(FocusManager.instance.primaryFocus?.context?.widget, isNot(isA<EditableText>()));
      expectBackgroundListening();

      await say(tester, '閉じる');
      expect(find.byTooltip('検索を閉じる'), findsNothing);
      expect(find.byTooltip('検索'), findsOneWidget);
      expectBackgroundListening();
    });

    testWidgets('「戻る」でも検索を閉じる。タップで開いた検索は従来どおり入力欄にフォーカスする', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成')]);
      await say(tester, '資料を探して');
      await say(tester, '戻る');
      expect(find.byTooltip('検索を閉じる'), findsNothing);

      await tester.tap(find.byTooltip('検索'));
      await settle(tester);
      expect(listener().isListening, isFalse, reason: 'タップで開いたら入力欄にフォーカスし、聞き取りは止まる');
      expect(listener().status, VoiceModeStatus.paused);
    });

    testWidgets('検索の上に開いた詳細で「戻る」と言うと、詳細を閉じる（下に隠れた検索は閉じない）', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成'), _task('2', '資料の確認')]);
      await say(tester, '検索 資料');
      await settle(tester, 5);
      await say(tester, '2番目を開いて');
      await settle(tester, 10);
      expect(location(), '/tasks/2');
      await say(tester, '戻る');
      await settle(tester, 5);
      expect(location(), '/tasks');
      expect(find.byTooltip('検索を閉じる'), findsOneWidget, reason: '検索は開いたまま');
    });
  });

  group('声で開いたフォーム', () {
    testWidgets('声で開いたフォームは入力欄にフォーカスせず、開いた直後から「戻る」が効く', (tester) async {
      await pumpApp(tester, '/ideas');
      expectBackgroundListening();
      // 音声コマンドの画面操作（AppVoiceUi.push）と同じ印を付けて開く
      VoiceOpenedScreens.markOpened('/ideas/new');
      router.push('/ideas/new');
      await settle(tester);
      expect(location(), '/ideas/new');
      expect(FocusManager.instance.primaryFocus?.context?.widget, isNot(isA<EditableText>()));
      expectBackgroundListening();
      await say(tester, '戻る');
      expect(location(), '/ideas');
    });

    test('目印は1回だけ・同じ画面だけ・少しの間だけ効く', () {
      var now = DateTime(2026, 11, 11, 9);
      VoiceOpenedScreens.now = () => now;
      addTearDown(() => VoiceOpenedScreens.now = DateTime.now);
      VoiceOpenedScreens.markOpened('/ideas/new');
      expect(VoiceOpenedScreens.consume('/concerns/new'), isFalse);
      expect(VoiceOpenedScreens.consume('/ideas/new'), isTrue);
      expect(VoiceOpenedScreens.consume('/ideas/new'), isFalse, reason: '受け取ったら消える');

      VoiceOpenedScreens.markOpened('/themes/new');
      now = now.add(VoiceOpenedScreens.ttl + const Duration(seconds: 1));
      expect(VoiceOpenedScreens.consume('/themes/new'), isFalse, reason: '古い目印はタップで開いた画面に効かない');
    });
  });
}
