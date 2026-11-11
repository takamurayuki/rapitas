import 'dart:math' as math;

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
import 'package:rapitas_mobile/widgets/voice_mode_indicator.dart';
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
      // タイトルバーはキーボード表示中も残るので、表示は出したまま「一時停止」になる
      expect(indicator, findsOneWidget);
      expect(listener().status, VoiceModeStatus.paused);
      expect(find.byKey(const ValueKey('voice-mode-dot-paused')), findsOneWidget);

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
      // シートはコマンドを待っている：処理中（回る輪）ではなく回答待ち（？）
      expect(listener().status, VoiceModeStatus.awaiting);
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

    testWidgets('解釈できない発話はシートを開かず聞き流す。受付の表示は「話せます」のまま、説明だけ少しの間足す', (tester) async {
      await pumpApp(tester, '/tasks');
      await say(tester, '明日の会議の資料を作る');
      expect(sheet, findsNothing);
      expect(find.text('理解できませんでした'), findsNothing);
      expect(tasks.created, isEmpty);
      // 「コマンドではなかった」は受付の状態ではない（gaps-design §8）。再び話せるので「話せます」
      expect(listener().status, VoiceModeStatus.ready);
      expect(listener().recentlyIgnored, isTrue);
      expect(find.byKey(const ValueKey('voice-mode-dot-ready')), findsOneWidget);
      expect(find.bySemanticsLabel(RegExp('コマンドではなかったので聞き流しました')), findsOneWidget);
      expectBackgroundListening();

      // 少しすると説明も消える
      await settle(tester, 25);
      expect(listener().status, VoiceModeStatus.ready);
      expect(listener().recentlyIgnored, isFalse);
      expect(find.bySemanticsLabel('音声操作：話せます'), findsOneWidget);
    });

    testWidgets('「キャンセル」だけの発話も聞き流す', (tester) async {
      await pumpApp(tester, '/tasks');
      await say(tester, 'キャンセル');
      expect(sheet, findsNothing);
      expect(listener().recentlyIgnored, isTrue);
      expect(listener().status, VoiceModeStatus.ready);
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

    /// 聞き取り表示が入っている AppBar
    Finder appBarOfIndicator() => find.ancestor(of: indicator, matching: find.byType(AppBar));

    for (final path in [...routes, '/ideas/new', '/concerns/new', '/themes/new', '/categories/new']) {
      testWidgets('$path：聞き取り表示はタイトルバーの既存アイコンの左隣（無ければ右端）にあり、ほかの要素と重ならない（左下には無い）',
          (tester) async {
        await pumpApp(tester, path);
        expect(find.byKey(const ValueKey('voice-command-fab')), findsNothing);
        expect(find.byIcon(Icons.settings_voice), findsNothing);
        expect(indicator, findsOneWidget);

        // タイトルバーの中にある（左下の浮いた表示は無くなった）
        final bar = appBarOfIndicator();
        expect(bar, findsOneWidget, reason: 'AppBar の中に置く');
        for (final scaffold in tester.widgetList<Scaffold>(find.byType(Scaffold))) {
          expect(scaffold.floatingActionButton, isNot(isA<VoiceModeIndicator>()), reason: 'FAB の枠には置かない');
        }

        final rect = tester.getRect(indicator);
        final screen = tester.getRect(find.byType(MaterialApp).first);
        final barRect = tester.getRect(bar);
        final dot = tester.getRect(find.byKey(ValueKey('voice-mode-dot-${listener().status.name}')));
        expect(rect.width, VoiceModeIndicator.hitSize);
        expect(rect.height, VoiceModeIndicator.hitSize);
        expect(dot.width, VoiceModeIndicator.dotSize);
        final appBar = tester.widget<AppBar>(bar);
        // actions の先頭に置く。ほかのアクションはすべて表示の右に並び、最後のものは従来どおり画面の右端まで
        final actions = appBar.actions!;
        expect(actions.first, isA<VoiceModeIndicator>(), reason: 'actions の先頭');
        final rest = actions.skip(1).toList();
        if (rest.isEmpty) {
          // アイコンの無い画面：右端。丸の中心は画面の右端から 28px
          expect(rect.center.dx, closeTo(screen.right - 28, 0.01), reason: '右端に置く');
        } else {
          final rects = [for (final a in rest) tester.getRect(find.descendant(of: bar, matching: find.byWidget(a)))];
          for (final r in rects) {
            expect(r.left, greaterThanOrEqualTo(rect.right), reason: '既存のアイコンは表示の右に並ぶ');
          }
          expect(rects.last.right, closeTo(screen.right, 0.01), reason: '既存のアイコンの右端は従来どおり');
          expect(rect.center.dx, closeTo(rects.first.left - VoiceModeIndicator.slotWidth / 2, 0.01),
              reason: '先頭のアイコンのすぐ左隣');
        }
        // 上下はバーの帯（ステータスバーの下）の中央
        final toolbar = tester.widget<AppBar>(bar).toolbarHeight ?? kToolbarHeight;
        expect(rect.center.dy, closeTo(barRect.bottom - toolbar / 2, 0.01));
        expect(barRect.contains(rect.topLeft) && barRect.contains(rect.bottomRight - const Offset(0.01, 0.01)), isTrue);

        // 同じバーの既存の操作（ボタン類・戻る・ハンバーガー）とタイトルに重ならない。
        // leading 側（戻る・ハンバーガー・キャンセル）は表示より左、actions 側は右
        final others = find.descendant(
          of: bar,
          matching: find.byWidgetPredicate((w) =>
              w is IconButton || w is ButtonStyleButton || w is PopupMenuButton || w is BackButton || w is DrawerButton),
        );
        for (final element in others.evaluate()) {
          final box = element.renderObject! as RenderBox;
          final other = box.localToGlobal(Offset.zero) & box.size;
          expect(rect.overlaps(other), isFalse, reason: '${element.widget.runtimeType} と重ならない');
          expect(other.right <= rect.left || other.left >= rect.right, isTrue);
        }
        if (appBar.leading != null) {
          final lead = tester.getRect(find.descendant(of: bar, matching: find.byWidget(appBar.leading!)));
          expect(lead.right, lessThanOrEqualTo(rect.left), reason: 'leading は従来どおり左');
        }
        final title = tester.widget<AppBar>(bar).title;
        if (title != null) {
          final titleRect = tester.getRect(find.descendant(of: bar, matching: find.byWidget(title)));
          expect(rect.overlaps(titleRect), isFalse, reason: 'タイトルと重ならない');
          expect(titleRect.left, lessThan(rect.left), reason: 'タイトルは従来どおり左');
        }
        for (final fab in tester.widgetList<FloatingActionButton>(find.byType(FloatingActionButton))) {
          expect(rect.overlaps(tester.getRect(find.byWidget(fab))), isFalse);
        }
      });
    }

    testWidgets('ホーム：ダッシュボードのアイコンは無く、並びは［音声表示・ベル］', (tester) async {
      await pumpApp(tester, '/');
      final bar = appBarOfIndicator();
      expect(find.byIcon(Icons.dashboard_outlined), findsNothing);
      expect(find.byIcon(Icons.dashboard), findsNothing);
      final actions = tester.widget<AppBar>(bar).actions!;
      expect(actions, hasLength(2));
      expect(actions[0], isA<VoiceModeIndicator>());
      final bell = find.descendant(of: bar, matching: find.byIcon(Icons.notifications_outlined));
      expect(bell, findsOneWidget);
      expect(tester.getRect(bell).left, greaterThan(tester.getRect(indicator).right));
      // ベルの行き先は従来どおり
      await tester.tap(bell);
      await settle(tester);
      expect(location(), AppRoutes.notifications);
    });

    testWidgets('タスクの検索バー：クリアがあればその左隣、無ければ右端', (tester) async {
      await pumpApp(tester, '/tasks');
      await tester.tap(find.byTooltip('検索'));
      await settle(tester);
      final screen = tester.getRect(find.byType(MaterialApp).first);
      expect(tester.getRect(indicator).center.dx, closeTo(screen.right - 28, 0.01));
      await tester.enterText(find.byType(TextField), 'abc');
      await settle(tester);
      final clear = tester.getRect(find.widgetWithIcon(IconButton, Icons.clear));
      expect(clear.right, closeTo(screen.right, 0.01), reason: 'クリアは従来どおり右端');
      expect(tester.getRect(indicator).right, lessThanOrEqualTo(clear.left));
    });

    testWidgets('ラピ画面：アバター・名前・ガラスのボタンと重ならず、ボタンと左右対称', (tester) async {
      await pumpApp(tester, '/rapi');
      final rect = tester.getRect(indicator);
      final bar = tester.widget<AppBar>(appBarOfIndicator());
      expect(bar.toolbarHeight, 92);
      final leading = tester.getRect(find.byWidget(bar.leading!));
      final title = tester.getRect(find.byWidget(bar.title!));
      final screen = tester.getRect(find.byType(MaterialApp).first);
      expect(rect.overlaps(leading), isFalse);
      expect(rect.overlaps(title), isFalse);
      expect(leading.center.dx - screen.left, closeTo(screen.right - rect.center.dx, 0.01), reason: '左右対称');
      expect(rect.center.dy, closeTo(leading.center.dy, 0.01), reason: '高さもボタンと揃う');
      // 入力欄の上（本文）にはもう無い。タイトルバーの中の1つだけ
      expect(indicator, findsOneWidget);
    });

    for (final path in ['/', '/rapi', '/settings', '/themes']) {
      testWidgets('$path：右端の表示をタップするとコマンドシートが開く', (tester) async {
        await pumpApp(tester, path);
        await tester.tap(indicator);
        await settle(tester);
        expect(sheet, findsOneWidget);
        expect(listener().status, VoiceModeStatus.awaiting);
        await tester.tap(find.byKey(const ValueKey('voice-close')));
        await settle(tester);
        expect(sheet, findsNothing);
        expectBackgroundListening();
      });
    }

    testWidgets('モードがオフならどの画面のタイトルバーにも出ず、幅も取らない', (tester) async {
      await pumpApp(tester, '/', modeOn: false);
      for (final path in routes) {
        router.go(path);
        await settle(tester);
        expect(indicator, findsNothing, reason: path);
        for (final element in find.byType(VoiceModeIndicator).evaluate()) {
          expect((element.renderObject! as RenderBox).size.width, 0, reason: '$path：右端に空きを作らない');
        }
      }
    });

    testWidgets('開始はできても失敗で終わり続けたら「使えない」表示にし、普通に終われば戻す', (tester) async {
      await pumpApp(tester, '/tasks');
      final mark = find.descendant(of: indicator, matching: find.byKey(const ValueKey('voice-mode-dot-unavailable')));
      for (var i = 1; i <= 3; i++) {
        expectBackgroundListening();
        speech.end(DictationEnd.failed); // 始まった直後に認識エラーで終わる
        await settle(tester, 1);
        if (i < 3) {
          expect(listener().status, isIn([VoiceModeStatus.preparing, VoiceModeStatus.ready]),
              reason: '$i 回目ではまだ使えない扱いにしない');
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
      expect(listener().status, isIn([VoiceModeStatus.preparing, VoiceModeStatus.ready]));
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

  group('聞き取り表示のアイコン（状態ごとの描画）', () {
    Future<void> pumpDot(WidgetTester tester, VoiceModeStatus status, {Brightness brightness = Brightness.light}) async {
      await tester.pumpWidget(MaterialApp(
        theme: ThemeData(brightness: brightness),
        home: Scaffold(body: Center(child: VoiceModeDot(status: status, onTap: () {}))),
      ));
      // MaterialApp はテーマの切り替えをアニメーションするので、切り替わり終わるまで待つ
      await tester.pump(const Duration(milliseconds: 500));
    }

    Icon iconOfDot(WidgetTester tester) => tester.widget<Icon>(find.byKey(const ValueKey('voice-mode-icon')));

    // 状態 → Material アイコンと色（2026-11-11 本人決定。見本 nav25/ui-preview/indicator-mock-v5.html）
    final expected = <VoiceModeStatus, (IconData, Color)>{
      VoiceModeStatus.ready: (Icons.more_horiz, VoiceModeDot.navy),
      VoiceModeStatus.hearing: (Icons.graphic_eq, VoiceModeDot.green),
      VoiceModeStatus.processing: (Icons.autorenew, VoiceModeDot.purple),
      VoiceModeStatus.awaiting: (Icons.help, VoiceModeDot.orange),
      VoiceModeStatus.preparing: (Icons.more_horiz, VoiceModeDot.faint),
      VoiceModeStatus.paused: (Icons.pause, VoiceModeDot.grey),
      VoiceModeStatus.unavailable: (Icons.block, VoiceModeDot.darkGrey),
    };

    for (final entry in expected.entries) {
      final status = entry.key;
      final (iconData, color) = entry.value;
      testWidgets('${status.name}：文字を使わず標準アイコンと色で表す（大きさは従来どおり）', (tester) async {
        await pumpDot(tester, status);
        final dot = find.byKey(ValueKey('voice-mode-dot-${status.name}'));
        expect(dot, findsOneWidget);
        // アイコンは 1 つだけで、決めたものと色
        final icons = find.descendant(of: find.byType(VoiceModeDot), matching: find.byType(Icon));
        expect(icons, findsOneWidget);
        final icon = iconOfDot(tester);
        expect(icon.icon, iconData);
        expect(icon.color, color);
        expect(icon.size, VoiceModeDot.iconSize);
        // マイク系のアイコンは使わない（入力欄のマイクと意味が重なるため）
        for (final mic in [Icons.mic, Icons.mic_none, Icons.mic_off, Icons.settings_voice, Icons.keyboard_voice]) {
          expect(find.byIcon(mic), findsNothing);
        }
        // 大きさは従来どおり（見た目 30・タップ範囲 40）。アイコンはその中に収まる
        expect(tester.getSize(dot), const Size.square(VoiceModeIndicator.dotSize));
        expect(tester.getSize(find.byKey(const ValueKey('voice-mode-indicator'))),
            const Size.square(VoiceModeIndicator.hitSize));
        // 回転中（処理中）も外接枠では測らず、回る前の大きさと中心の位置で確かめる（autorenew の絵は円形なので枠内に収まる）
        final iconSize = tester.getSize(icons);
        expect(iconSize.width, lessThanOrEqualTo(VoiceModeIndicator.dotSize), reason: 'アイコンが 30 四方からはみ出さない');
        expect(iconSize.height, lessThanOrEqualTo(VoiceModeIndicator.dotSize), reason: 'アイコンが 30 四方からはみ出さない');
        expect(tester.getCenter(icons), tester.getCenter(dot), reason: '印の中央に置く');
        // 囲み（枠線・背景の丸）は付けない
        final boxes = tester.widgetList<DecoratedBox>(find.descendant(of: dot, matching: find.byType(DecoratedBox)));
        expect(boxes, isEmpty, reason: 'アウトラインや囲みは付けない');
        // 文字は出さない。説明は読み上げ（Semantics）にだけある
        expect(find.descendant(of: find.byType(VoiceModeDot), matching: find.byType(Text)), findsNothing);
        expect(find.bySemanticsLabel(VoiceModeDot.labelOf(status)), findsOneWidget);
      });
    }

    testWidgets('アイコンの割り当ては状態の区別を保つ（同じアイコンは話せますと準備中だけで、色で分ける）', (tester) async {
      final shown = VoiceModeStatus.values.where((s) => s != VoiceModeStatus.off);
      final byIcon = <IconData, List<VoiceModeStatus>>{};
      for (final s in shown) {
        byIcon.putIfAbsent(VoiceModeDot.iconOf(s), () => []).add(s);
      }
      expect(byIcon[Icons.more_horiz], [VoiceModeStatus.preparing, VoiceModeStatus.ready]);
      expect(byIcon.values.where((v) => v.length > 1), hasLength(1));
      for (final b in Brightness.values) {
        expect(VoiceModeDot.colorOf(VoiceModeStatus.ready, b), isNot(VoiceModeDot.colorOf(VoiceModeStatus.preparing, b)));
        expect(VoiceModeDot.colorOf(VoiceModeStatus.unavailable, b), isNot(VoiceModeDot.colorOf(VoiceModeStatus.paused, b)));
      }
    });

    testWidgets('話せますはごくゆっくり明滅し、受け取り中・回答待ち・準備中・一時停止・使えないは静止', (tester) async {
      await pumpDot(tester, VoiceModeStatus.ready);
      double opacity() => tester.widget<FadeTransition>(find.byKey(const ValueKey('voice-mode-breathe'))).opacity.value;
      final samples = <double>[];
      for (var i = 0; i < 45; i++) {
        await tester.pump(const Duration(milliseconds: 100));
        samples.add(opacity());
      }
      expect(samples.reduce(math.max), greaterThan(0.9));
      expect(samples.reduce(math.min), lessThan(0.65));
      expect(samples.reduce(math.min), greaterThanOrEqualTo(0.55), reason: '消えたように見えるほど暗くしない');
      // 速くしない：明るい→暗いに 1.5 秒以上かける
      expect(VoiceModeDot.breatheHalf, greaterThanOrEqualTo(const Duration(milliseconds: 1500)));
      expect(VoiceModeDot.spinCycle, greaterThanOrEqualTo(const Duration(seconds: 1)));

      for (final still in [
        VoiceModeStatus.hearing,
        VoiceModeStatus.awaiting,
        VoiceModeStatus.preparing,
        VoiceModeStatus.paused,
        VoiceModeStatus.unavailable,
      ]) {
        await pumpDot(tester, still);
        expect(tester.hasRunningAnimations, isFalse, reason: still.name);
      }
    });

    testWidgets('処理中は autorenew が回り続ける', (tester) async {
      await pumpDot(tester, VoiceModeStatus.processing);
      final spin = find.byKey(const ValueKey('voice-mode-spin'));
      expect(find.descendant(of: spin, matching: find.byIcon(Icons.autorenew)), findsOneWidget);
      double turns() => tester.widget<RotationTransition>(spin).turns.value;
      final before = turns();
      await tester.pump(const Duration(milliseconds: 400));
      expect(turns(), isNot(before));
      expect(tester.hasRunningAnimations, isTrue);
    });

    testWidgets('ダークでも「話せます」は「準備中」より目立ち、「使えない」はバーの上で見える', (tester) async {
      for (final brightness in Brightness.values) {
        final background = brightness == Brightness.dark ? const Color(0xFF141218) : Colors.white;
        double contrast(Color c) {
          final a = c.computeLuminance();
          final b = background.computeLuminance();
          return (math.max(a, b) + 0.05) / (math.min(a, b) + 0.05);
        }

        Future<Color> shown(VoiceModeStatus status) async {
          await pumpDot(tester, status, brightness: brightness);
          return iconOfDot(tester).color!;
        }

        final ready = contrast(await shown(VoiceModeStatus.ready));
        final preparing = contrast(await shown(VoiceModeStatus.preparing));
        expect(ready, greaterThan(preparing), reason: brightness.name);
        expect(ready, greaterThanOrEqualTo(3), reason: '${brightness.name}：話せますはバーの上で見える');
        expect(contrast(await shown(VoiceModeStatus.unavailable)), greaterThanOrEqualTo(3), reason: brightness.name);
      }
    });

    testWidgets('動いている間の描き直しは印の中だけ（外側は描き直さない）', (tester) async {
      for (final moving in [VoiceModeStatus.ready, VoiceModeStatus.processing]) {
        final outer = _CountingPainter();
        await tester.pumpWidget(MaterialApp(
          home: Scaffold(
            body: Center(
              child: CustomPaint(
                painter: outer,
                child: VoiceModeDot(key: ValueKey(moving), status: moving, onTap: () {}),
              ),
            ),
          ),
        ));
        await tester.pump(const Duration(milliseconds: 300));
        // 動きの部分は RepaintBoundary の内側にある
        final boundary = find.byKey(const ValueKey('voice-mode-lamp-boundary'));
        expect(tester.widget(boundary), isA<RepaintBoundary>());
        final effect = moving == VoiceModeStatus.ready ? 'voice-mode-breathe' : 'voice-mode-spin';
        expect(find.descendant(of: boundary, matching: find.byKey(ValueKey(effect))), findsOneWidget, reason: moving.name);
        final before = outer.count;
        for (var i = 0; i < 20; i++) {
          await tester.pump(const Duration(milliseconds: 50));
        }
        expect(tester.hasRunningAnimations, isTrue, reason: moving.name);
        expect(outer.count, before, reason: '${moving.name}：印の外側まで描き直している');
      }
    });
  });
}

/// 描かれた回数を数える（ランプの外側が描き直されていないかの確認用）
class _CountingPainter extends CustomPainter {
  int count = 0;

  @override
  void paint(Canvas canvas, Size size) => count++;

  @override
  bool shouldRepaint(_CountingPainter old) => false;
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
