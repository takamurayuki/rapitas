import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/routes.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/settings_provider.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/settings/voice_mode_tile.dart';
import 'package:rapitas_mobile/services/approval_service.dart';
import 'package:rapitas_mobile/services/dictation_coordinator.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:rapitas_mobile/services/task_service.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:rapitas_mobile/services/voice_mode_listener.dart';
import 'package:rapitas_mobile/services/voice_route_tracker.dart';
import 'package:rapitas_mobile/widgets/voice_mode_host.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 端末の聞き取りの偽物（常時聞き取り・シート・チャットのマイクが、交通整理を通して共有する）
class _FakeSpeech implements DictationService {
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
    cancels++;
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
      tasks.where((t) => status == null || t.status == status).toList();

  @override
  Future<List<Task>> searchTasks(String query) async => tasks.where((t) => t.title.contains(query)).toList();

  @override
  Future<Task> createTask(Map<String, dynamic> data) async {
    created.add(data);
    return _task('99', data['title'] as String);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeThemes implements ThemeService {
  @override
  Future<List<TaskTheme>> getThemes() async => [TaskTheme(id: '11', name: '英語学習')];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

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

Task _task(String id, String title, {String status = 'todo'}) => Task(
      id: id,
      title: title,
      status: status,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

ApprovalRequest _approval(String id, String title) =>
    ApprovalRequest(id: id, title: title, status: 'pending', createdAt: DateTime(2026, 11, 9));

/// 張り直しの待ち（テストでは短く）
const _restart = Duration(milliseconds: 50);

void main() {
  late _FakeSpeech speech;
  late _FakeApprovals approvals;
  late _FakeTasks tasks;
  late _FakeRapiChat rapiChat;
  late GoRouter router;
  late ProviderContainer container;
  late DictationStartFailure? permission;

  VoiceModeListener listener() => container.read(voiceModeListenerProvider);
  DictationCoordinator coordinator() => container.read(dictationCoordinatorProvider);
  String location() => router.state.uri.path;
  final indicator = find.byKey(const ValueKey('voice-mode-indicator'));
  final sheet = find.text('認識した文');

  /// シートは聞き取り中の表示が点滅し続けるので pumpAndSettle は使わず、時間を進めて待つ
  Future<void> settle(WidgetTester tester, [int frames = 6]) async {
    for (var i = 0; i < frames; i++) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> pumpApp(
    WidgetTester tester,
    String initialLocation, {
    bool modeOn = true,
    List<ApprovalRequest> approvalItems = const [],
    List<Task> taskItems = const [],
  }) async {
    SharedPreferences.setMockInitialValues({if (modeOn) VoiceCommandModeNotifier.prefsKey: true});
    speech = _FakeSpeech();
    approvals = _FakeApprovals(approvalItems);
    tasks = _FakeTasks(taskItems);
    rapiChat = _FakeRapiChat();
    permission = null;
    final tracker = VoiceRouteTracker();
    router = AppRoutes.createRouter(tracker: tracker, initialLocation: initialLocation);
    container = ProviderContainer(overrides: [
      speechDictationProvider.overrideWithValue(speech),
      voicePermissionProvider.overrideWithValue(() async => permission),
      voiceModeListenerProvider.overrideWith((ref) => VoiceModeListener(
            coordinator: ref.watch(dictationCoordinatorProvider),
            parser: ref.watch(voiceCommandParserProvider),
            restartDelay: _restart,
            quickEnd: Duration.zero,
          )),
      approvalServiceProvider.overrideWithValue(approvals),
      taskServiceProvider.overrideWithValue(tasks),
      themeServiceProvider.overrideWithValue(_FakeThemes()),
      voiceRouteTrackerProvider.overrideWithValue(tracker),
      rapiChatProvider.overrideWith(() => rapiChat),
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

  /// 常時聞き取りで話す（背面の聞き取りが開いていること）
  Future<void> say(WidgetTester tester, String words) async {
    expect(speech.active, isTrue, reason: '「$words」の前に聞き取りが始まっていない');
    speech.say(words);
    await settle(tester);
  }

  void expectBackgroundListening() {
    expect(listener().isListening, isTrue, reason: '常時聞き取りが開いている');
    expect(coordinator().foregroundActive.value, isFalse);
    expect(speech.active, isTrue);
  }

  group('設定', () {
    test('既定はオフ。保存した値を読み込み、切り替えると保存する', () async {
      SharedPreferences.setMockInitialValues({});
      final off = VoiceCommandModeNotifier();
      expect(off.state, isFalse);
      await Future<void>.delayed(Duration.zero);
      expect(off.state, isFalse);

      await off.setEnabled(true);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(VoiceCommandModeNotifier.prefsKey), isTrue);

      // 次の起動では保存した値から始まる
      final next = VoiceCommandModeNotifier();
      await Future<void>.delayed(Duration.zero);
      expect(next.state, isTrue);
    });

    testWidgets('オンにすると許可を求め、許可されればオンで保存する', (tester) async {
      await pumpApp(tester, '/settings', modeOn: false);
      await tester.scrollUntilVisible(find.byType(VoiceModeTile), 200);
      expect(tester.widget<SwitchListTile>(find.byKey(const ValueKey('voice-mode-switch'))).value, isFalse);
      expect(indicator, findsNothing);

      await tester.tap(find.byKey(const ValueKey('voice-mode-switch')));
      await settle(tester);
      expect(container.read(voiceCommandModeProvider), isTrue);
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getBool(VoiceCommandModeNotifier.prefsKey), isTrue);
      expect(indicator, findsOneWidget, reason: 'オンにすると聞き取り表示が出る');
      expectBackgroundListening();
    });

    testWidgets('許可されなければオフに戻し、理由を出す（聞き取りは始めない）', (tester) async {
      await pumpApp(tester, '/settings', modeOn: false);
      permission = DictationStartFailure.permissionDenied;
      await tester.scrollUntilVisible(find.byType(VoiceModeTile), 200);
      await tester.tap(find.byKey(const ValueKey('voice-mode-switch')));
      await settle(tester);

      expect(container.read(voiceCommandModeProvider), isFalse);
      expect(tester.widget<SwitchListTile>(find.byKey(const ValueKey('voice-mode-switch'))).value, isFalse);
      expect(find.text(voiceModePermissionMessage), findsWidgets); // スイッチの下とスナックバー
      expect(speech.starts, 0);
      expect(indicator, findsNothing);
    });
  });

  group('常時聞き取りの開始・停止', () {
    testWidgets('モードがオフなら聞かない', (tester) async {
      await pumpApp(tester, '/tasks', modeOn: false);
      expect(speech.starts, 0);
      expect(indicator, findsNothing);
    });

    testWidgets('オンなら聞き取りを張り続ける（終わったら張り直す）', (tester) async {
      await pumpApp(tester, '/tasks');
      expectBackgroundListening();
      final first = speech.starts;
      speech.end(DictationEnd.noSpeech); // 無音で終わった
      await settle(tester);
      expect(speech.starts, first + 1);
      expectBackgroundListening();
      speech.end(DictationEnd.completed); // 上限時間で終わった（何も聞こえず）
      await settle(tester);
      expect(speech.starts, first + 2);
      expectBackgroundListening();
    });

    testWidgets('アプリが背面にある間は止め、前面に戻ったら再開する', (tester) async {
      await pumpApp(tester, '/tasks');
      expectBackgroundListening();

      for (final s in [AppLifecycleState.inactive, AppLifecycleState.hidden, AppLifecycleState.paused]) {
        tester.binding.handleAppLifecycleStateChanged(s);
      }
      await settle(tester);
      expect(listener().isListening, isFalse);
      expect(speech.active, isFalse);
      expect(listener().status, VoiceModeStatus.paused);

      for (final s in [AppLifecycleState.hidden, AppLifecycleState.inactive, AppLifecycleState.resumed]) {
        tester.binding.handleAppLifecycleStateChanged(s);
      }
      await settle(tester);
      expectBackgroundListening();
    });

    testWidgets('キーボード表示中は止める', (tester) async {
      await pumpApp(tester, '/tasks');
      expectBackgroundListening();
      tester.view.viewInsets = const FakeViewPadding(bottom: 300);
      addTearDown(tester.view.resetViewInsets);
      await settle(tester);
      expect(listener().isListening, isFalse);
      expect(speech.active, isFalse);
      expect(indicator, findsNothing, reason: 'キーボード表示中は表示も隠す');

      tester.view.resetViewInsets();
      await settle(tester);
      expectBackgroundListening();
    });

    testWidgets('テキスト入力欄にフォーカスがある間は止める', (tester) async {
      await pumpApp(tester, '/ideas/new');
      // タイトル欄が autofocus なので、開いた時点では聞かない
      expect(listener().isListening, isFalse);
      expect(speech.starts, 0);
      FocusManager.instance.primaryFocus?.unfocus();
      await settle(tester);
      expectBackgroundListening();

      await tester.tap(find.byType(TextField).first);
      await settle(tester);
      expect(listener().isListening, isFalse);
      expect(speech.active, isFalse);

      FocusManager.instance.primaryFocus?.unfocus();
      await settle(tester);
      expectBackgroundListening();
    });

    testWidgets('聞き取り表示をタップするとシートを開き、開いている間は常時聞き取りを止める', (tester) async {
      await pumpApp(tester, '/approvals', approvalItems: [_approval('1', 'ログイン画面の変更')]);
      expectBackgroundListening();
      await tester.tap(indicator);
      await settle(tester);
      expect(sheet, findsOneWidget);
      expect(listener().isListening, isFalse);
      expect(listener().status, VoiceModeStatus.working);
      // シートの聞き取り（前面）だけが動いている
      expect(coordinator().foregroundActive.value, isTrue);

      await tester.tap(find.byKey(const ValueKey('voice-close')));
      await settle(tester);
      expect(sheet, findsNothing);
      expectBackgroundListening();
    });

    testWidgets('チャットのマイクが動いている間は止め、終わったら再開する', (tester) async {
      await pumpApp(tester, '/rapi');
      expectBackgroundListening();
      await tester.tap(find.byKey(const ValueKey('rapi-mic')));
      await settle(tester);
      expect(listener().isListening, isFalse, reason: 'チャットのマイクに譲る');
      expect(coordinator().foregroundActive.value, isTrue);
      expect(find.text('聞き取り中…'), findsOneWidget);

      // チャットの読み上げはこれまでどおり（コマンドとしては読まない）
      speech.say('タスクを開いて');
      await settle(tester);
      expect(rapiChat.sent, ['タスクを開いて']);
      expect(location(), '/rapi');
      expectBackgroundListening();
    });
  });

  group('確定した発話', () {
    testWidgets('そのまま実行できるコマンドはシートなしで実行し、結果をスナックバーで出す', (tester) async {
      await pumpApp(tester, '/approvals');
      await say(tester, 'タスクを開いて');
      expect(sheet, findsNothing);
      expect(location(), '/tasks');
      expect(find.text('タスクを開きました'), findsOneWidget);
      expectBackgroundListening();
    });

    testWidgets('絞り込みもシートなしで適用する', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', '資料作成', status: 'in-progress')]);
      await say(tester, 'フィルタ 進行中');
      expect(sheet, findsNothing);
      expect(container.read(taskFilterProvider).status, 'in-progress');
      expect(find.text('タスクを進行中で絞り込みました'), findsOneWidget);
      expectBackgroundListening();
    });

    testWidgets('できないこと（いまの画面への移動）は理由だけスナックバーで出す', (tester) async {
      await pumpApp(tester, '/tasks');
      await say(tester, 'タスクを開いて');
      expect(sheet, findsNothing);
      expect(find.text('いまタスクを表示しています'), findsOneWidget);
      expectBackgroundListening();
    });

    testWidgets('対話が要るコマンドはシートを開き、その発話の解釈から続ける。終わったら常時聞き取りに戻る',
        (tester) async {
      await pumpApp(tester, '/approvals',
          approvalItems: [_approval('1', 'ログイン画面の変更'), _approval('2', 'API の追加')]);
      await say(tester, '2番目を承認');
      expect(sheet, findsOneWidget);
      expect(find.text('2番目を承認'), findsOneWidget, reason: '常時聞き取りの文を認識した文として出す');
      expect(find.text('「API の追加」を承認しますか？'), findsOneWidget);
      expect(approvals.approved, isEmpty);
      expect(listener().isListening, isFalse);

      // シートが確認を聞いている（前面の聞き取り）
      expect(coordinator().foregroundActive.value, isTrue);
      speech.say('はい');
      await settle(tester);
      expect(approvals.approved, ['2']);
      await settle(tester, 25); // 成功後に自動で閉じる
      expect(sheet, findsNothing);
      expectBackgroundListening();
    });

    testWidgets('対象の選択が要るとシートなしの実行をやめてシートで選ばせる（画面は変えない）', (tester) async {
      await pumpApp(tester, '/tasks', taskItems: [_task('1', 'ログイン画面'), _task('2', 'ログアウト')]);
      await say(tester, 'ログを開いて');
      expect(sheet, findsOneWidget);
      expect(find.text('対象を選んでください'), findsOneWidget);
      expect(location(), '/tasks');
      speech.say('2番');
      await settle(tester, 25);
      expect(location(), '/tasks/2');
      expect(sheet, findsNothing);
      expectBackgroundListening();
    });

    testWidgets('タイトルの聞き取りが要る作成もシートで続ける', (tester) async {
      await pumpApp(tester, '/tasks');
      await say(tester, 'タスクを作成');
      expect(sheet, findsOneWidget);
      expect(find.text('タスクのタイトルを話してください'), findsOneWidget);
      expect(tasks.created, isEmpty);
    });

    testWidgets('解釈できない発話はシートを開かず、表示で「コマンドではなかった」と分かる', (tester) async {
      await pumpApp(tester, '/tasks');
      await say(tester, '明日の会議の資料を作る');
      expect(sheet, findsNothing);
      expect(find.text('理解できませんでした'), findsNothing);
      expect(tasks.created, isEmpty);
      expect(listener().status, VoiceModeStatus.ignored);
      expect(find.byKey(const ValueKey('voice-mode-dot-ignored')), findsOneWidget);
      expectBackgroundListening();

      // 少しすると聞き取り中の表示に戻る
      await settle(tester, 25);
      expect(listener().status, VoiceModeStatus.listening);
      expect(find.byKey(const ValueKey('voice-mode-dot-listening')), findsOneWidget);
    });

    testWidgets('「キャンセル」だけの発話も聞き流す', (tester) async {
      await pumpApp(tester, '/tasks');
      await say(tester, 'キャンセル');
      expect(sheet, findsNothing);
      expect(listener().status, VoiceModeStatus.ignored);
    });
  });

  group('表示', () {
    const routes = [
      '/',
      '/tasks',
      '/executions',
      '/approvals',
      '/rapi',
      '/settings',
      '/tasks/new',
      '/ideas',
      '/concerns',
      '/hypotheses',
      '/themes',
      '/categories',
      '/notifications',
      '/dashboard',
    ];

    for (final path in routes) {
      testWidgets('$path：音声ボタンは無く、聞き取り表示は 40px 以内で右下の FAB・下タブと重ならない', (tester) async {
        await pumpApp(tester, path);
        expect(find.byKey(const ValueKey('voice-command-fab')), findsNothing);
        expect(find.byIcon(Icons.settings_voice), findsNothing);
        expect(indicator, findsOneWidget);
        final rect = tester.getRect(indicator);
        expect(rect.width, lessThanOrEqualTo(40));
        expect(rect.height, lessThanOrEqualTo(40));
        expect(rect.center.dx, lessThan(100), reason: '左下に置く');
        for (final fab in tester.widgetList<FloatingActionButton>(find.byType(FloatingActionButton))) {
          expect(rect.overlaps(tester.getRect(find.byWidget(fab))), isFalse);
        }
        final nav = find.byType(NavigationBar);
        if (nav.evaluate().isNotEmpty) {
          expect(rect.overlaps(tester.getRect(nav)), isFalse);
        }
      });
    }

    testWidgets('開始はできても失敗で終わり続けたら「使えない」表示にし、普通に終われば戻す', (tester) async {
      await pumpApp(tester, '/tasks');
      final mark = find.descendant(of: indicator, matching: find.byIcon(Icons.mic_off));
      for (var i = 1; i <= 3; i++) {
        expectBackgroundListening();
        speech.end(DictationEnd.failed); // 始まった直後に認識エラーで終わる
        await settle(tester, 1);
        if (i < 3) {
          expect(listener().status, VoiceModeStatus.listening, reason: '$i 回目ではまだ使えない扱いにしない');
          expect(mark, findsNothing);
          await settle(tester); // 張り直しの間（失敗のたびに倍）を待つ
        }
      }
      expect(listener().status, VoiceModeStatus.unavailable);
      expect(mark, findsOneWidget);

      // 張り直しは続ける。普通に終わった聞き取りがあれば失敗の数えを戻す
      await settle(tester);
      expectBackgroundListening();
      expect(listener().status, VoiceModeStatus.unavailable, reason: '成功するまでは使えない表示のまま');
      speech.end(DictationEnd.completed);
      await settle(tester, 1);
      expect(listener().status, VoiceModeStatus.listening);
      expect(mark, findsNothing);
    });

    testWidgets('ドロワーを開いている間は隠す', (tester) async {
      await pumpApp(tester, '/tasks');
      expect(indicator, findsOneWidget);
      final scaffold = tester.firstState<ScaffoldState>(find.byWidgetPredicate((w) => w is Scaffold && w.drawer != null));
      scaffold.openDrawer();
      await settle(tester);
      expect(indicator, findsNothing);
    });

    testWidgets('権限が無くなっていたらモードをオフにして理由を出す', (tester) async {
      SharedPreferences.setMockInitialValues({VoiceCommandModeNotifier.prefsKey: true});
      final denied = _DeniedSpeech();
      final tracker = VoiceRouteTracker();
      router = AppRoutes.createRouter(tracker: tracker, initialLocation: '/tasks');
      container = ProviderContainer(overrides: [
        speechDictationProvider.overrideWithValue(denied),
        voiceRouteTrackerProvider.overrideWithValue(tracker),
        taskServiceProvider.overrideWithValue(_FakeTasks(const [])),
        themeServiceProvider.overrideWithValue(_FakeThemes()),
      ]);
      addTearDown(container.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp.router(
          routerConfig: router,
          builder: (context, child) => VoiceModeHost(router: router, child: child!),
        ),
      ));
      await settle(tester, 10);
      expect(container.read(voiceCommandModeProvider), isFalse);
      expect(find.text('マイクと音声認識の許可が無いため、音声操作モードをオフにしました'), findsOneWidget);
      expect(indicator, findsNothing);
    });
  });
}

class _DeniedSpeech implements DictationService {
  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async =>
      DictationStartFailure.permissionDenied;

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {}
}
