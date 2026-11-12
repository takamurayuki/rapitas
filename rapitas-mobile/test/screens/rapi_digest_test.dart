// 伴走の要約（ラピ伴走化 第2段階-1）の画面テスト。
//
// 受け入れ条件：人手待ちになったタスクについて、次にラピを開いたときに
// 「何が起きたか・あなたが決めること・その画面」が出る。見せた位置までを既読として返す。
// COMPANION_SCREENSHOT_DIR を付けて走らせると、画面のキャプチャ（実フォント）も書き出す。
import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/companion_digest.dart';
import 'package:rapitas_mobile/providers/approval_provider.dart';
import 'package:rapitas_mobile/providers/companion_provider.dart';
import 'package:rapitas_mobile/providers/connection_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/notification_provider.dart';
import 'package:rapitas_mobile/providers/rapi_chat_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/home/home_screen.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/companion_digest_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/home_screen_fakes.dart';

final _boundaryKey = GlobalKey();

/// 決まった要約を返し、既読の報告を控える
class _FakeDigestService implements CompanionDigestService {
  CompanionDigest digest;
  final List<List<({String taskId, int? cursor})>> seen = [];
  int gets = 0;
  bool fail = false;

  _FakeDigestService(this.digest);

  @override
  Future<CompanionDigest> getDigest() async {
    gets++;
    if (fail) throw Exception('offline');
    return digest;
  }

  @override
  Future<void> markSeen(Iterable<DigestItem> shown) async {
    seen.add([for (final i in shown) (taskId: i.taskId, cursor: i.cursor)]);
  }
}

/// 接続設定を読み込み済みにしておく（テストではキーチェーンの読み出しが終わらないため）
class _LoadedSettings extends ConnectionSettingsNotifier {
  _LoadedSettings() {
    state = const ConnectionSettings(baseUrl: 'http://127.0.0.1:3001', loaded: true);
  }
}

class _IdleDictation implements DictationService {
  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async =>
      null;
  @override
  Future<void> stop() async {}
  @override
  Future<void> cancel() async {}
}

/// サーバーの応答と同じ形（GET /assistant/companion/digest）
final _waitingJson = {
  'success': true,
  'decisionCount': 2,
  'items': [
    {
      'taskId': 42,
      'title': '設定画面を作る',
      'status': 'in-progress',
      'workflowStatus': 'plan_created',
      'haltReason': null,
      'since': {'transitions': 2, 'halts': 0, 'holds': 0, 'questions': 0, 'repairs': 0, 'replans': 0},
      'recent': [
        {'id': 301, 'kind': 'plan_ready', 'cause': 'file_saved:plan', 'toStatus': 'plan_created', 'at': '2026-11-12T03:00:00Z'},
        {'id': 300, 'kind': 'progress', 'cause': 'file_saved:research', 'toStatus': 'research_done', 'at': '2026-11-12T02:00:00Z'},
      ],
      'repairs': {'total': 0, 'topCause': null},
      'decision': {'kind': 'approve_plan', 'link': '/tasks/42/decide'},
      'cursor': 301,
    },
    {
      'taskId': 43,
      'title': 'ログの保存先を整理する',
      'status': 'in-progress',
      'workflowStatus': 'in_progress',
      'haltReason': 'budget_cost_exceeded',
      'since': {'transitions': 3, 'halts': 1, 'holds': 0, 'questions': 0, 'repairs': 2, 'replans': 0},
      'recent': [
        {'id': 312, 'kind': 'halted', 'cause': 'iteration_budget_halted', 'toStatus': 'in_progress', 'at': '2026-11-12T05:00:00Z'},
      ],
      'repairs': {'total': 2, 'topCause': 'capability'},
      'decision': {'kind': 'release_halt', 'haltReason': 'budget_cost_exceeded', 'link': '/tasks/43/decide'},
      'cursor': 312,
    },
    {
      'taskId': 44,
      'title': 'ヘルプの文面を直す',
      'status': 'in-progress',
      'workflowStatus': 'verify_done',
      'haltReason': null,
      'since': {'transitions': 1, 'halts': 0, 'holds': 0, 'questions': 0, 'repairs': 0, 'replans': 0},
      'recent': [
        {'id': 320, 'kind': 'progress', 'cause': 'file_saved:verify', 'toStatus': 'verify_done', 'at': '2026-11-12T06:00:00Z'},
      ],
      'repairs': {'total': 0, 'topCause': null},
      'decision': null,
      'cursor': 320,
    },
  ],
};

late _FakeDigestService _digestSvc;

/// 会話の履歴（[history] 件の案内）を先に積んでから、ラピを開く
Future<void> _pumpRapi(WidgetTester tester, {int history = 0}) async {
  SharedPreferences.setMockInitialValues({});
  final router = GoRouter(initialLocation: '/rapi', routes: [
    GoRoute(path: '/rapi', builder: (_, __) => const RapiScreen()),
    GoRoute(
        path: '/tasks/:id/decide',
        builder: (_, s) => Scaffold(body: Text('判断画面 ${s.pathParameters['id']}'))),
    GoRoute(path: '/tasks/:id', builder: (_, s) => Scaffold(body: Text('詳細 ${s.pathParameters['id']}'))),
  ]);
  final container = ProviderContainer(overrides: [
    assistantServiceProvider.overrideWithValue(FakeAssistant()),
    dictationServiceProvider.overrideWithValue(_IdleDictation()),
    taskListProvider.overrideWith((ref, filter) async => const []),
    companionDigestServiceProvider.overrideWithValue(_digestSvc),
    connectionSettingsProvider.overrideWith((ref) => _LoadedSettings()),
  ]);
  addTearDown(container.dispose);
  for (var i = 1; i <= history; i++) {
    container.read(rapiChatProvider.notifier).notice('これまでの会話 $i：昨日相談した設定画面の件で、保存先と入力の上限について話しました。');
  }
  await tester.pumpWidget(UncontrolledProviderScope(
    key: UniqueKey(),
    container: container,
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp.router(debugShowCheckedModeBanner: false, routerConfig: router),
    ),
  ));
  await tester.pumpAndSettle();
}

void main() {
  setUp(() => _digestSvc = _FakeDigestService(CompanionDigest.fromJson(_waitingJson)));

  testWidgets('opening ラピ shows what happened, what you decide, and the screen to do it on',
      (tester) async {
    // 要約が丸ごと入る高さ（行が見えた分だけ既読にするので、全部見える画面で確かめる）
    tester.view.physicalSize = const Size(390 * 3, 1500 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpRapi(tester);
    expect(find.byKey(const ValueKey('rapi-digest')), findsOneWidget);
    expect(find.text('あなたの判断を待っているタスクが2件あります'), findsOneWidget);

    // 何が起きたか
    expect(find.text('設定画面を作る'), findsOneWidget);
    expect(find.text('計画ができました'), findsOneWidget);
    expect(find.text('前回から2件の動き'), findsOneWidget);
    // あなたが決めること
    expect(find.text('あなたが決めること：計画の承認'), findsOneWidget);
    expect(find.text('この計画で進めてよいかを決めてください。'), findsOneWidget);
    // 止まったタスク：平易な理由と、差し戻しの原因
    expect(find.text('費用の上限に達したため、自動で止まっています。'), findsOneWidget);
    expect(find.text('前回から3件の動き（差し戻し2回・停止1回）'), findsOneWidget);
    // 「止まりました」は理由の文と重なるので出さない
    expect(find.text('自動で止まりました'), findsNothing);
    expect(find.textContaining('作業の中身に足りない点が見つかり'), findsOneWidget);
    // 決めることが無いタスクは、段階の動きだけ
    expect(find.text('「完了の確認中」に進みました'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-digest-decision-44')), findsNothing);

    // 見えた行の位置までを既読にする（全部見えているので3件まとめて1回）
    expect(_digestSvc.seen, [
      [(taskId: '42', cursor: 301), (taskId: '43', cursor: 312), (taskId: '44', cursor: 320)],
    ]);

    // 挨拶のあとに、ラピの報告として出る
    expect(tester.getTopLeft(find.byKey(const ValueKey('rapi-digest'))).dy,
        greaterThan(tester.getTopLeft(find.textContaining('ラピです')).dy));

    // その画面
    await tester.tap(find.byKey(const ValueKey('rapi-digest-open-42')));
    await tester.pumpAndSettle();
    expect(find.text('判断画面 42'), findsOneWidget);
  });

  // Codex レビュー nav42 指摘1の回帰：長い会話では一覧が末尾から始まり、挨拶の後の要約は画面の外にある
  testWidgets('long conversation on a phone: the digest off screen is not marked seen, and shows again',
      (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpRapi(tester, history: 30);

    // 要約は読み込んだが、画面の外にあるので既読にしない
    expect(_digestSvc.gets, 1);
    expect(_digestSvc.seen, isEmpty);
    // 最新の発言が見える位置から始まり（要約が後から届いても押し出されない）、要約は見えていない
    expect(find.textContaining('これまでの会話 30：'), findsOneWidget);
    expect(find.text('設定画面を作る'), findsNothing);

    // 入力などで描き直しても、見えていないものは既読にしない
    await tester.enterText(find.byType(TextField), 'あとで');
    await tester.pumpAndSettle();
    expect(_digestSvc.seen, isEmpty);

    // 次にラピを開いたときも、要約はまた出る（カーソルが進んでいないので、サーバーは同じ要約を返す）
    await _pumpRapi(tester, history: 30);
    expect(_digestSvc.gets, 2);
    expect(_digestSvc.seen, isEmpty);
    expect(find.textContaining('これまでの会話 30：'), findsOneWidget);
    // 上へ戻れば、前回見なかった要約がそのまま残っている
    await tester.fling(find.byType(ListView), const Offset(0, 6000), 4000);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('rapi-digest')), findsOneWidget);
    expect(find.text('あなたが決めること：計画の承認'), findsOneWidget);
  });

  testWidgets('long conversation: scrolling up marks only the rows that came into view, once each',
      (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpRapi(tester, history: 30);
    expect(_digestSvc.seen, isEmpty);

    // 末尾から少しずつ上へ戻す。下の行（44）から画面に入るので、最初に既読になるのは下の行だけ
    List<String> seenIds() => [for (final batch in _digestSvc.seen) ...batch.map((s) => s.taskId)];
    for (var i = 0; i < 60 && _digestSvc.seen.isEmpty; i++) {
      await tester.drag(find.byType(ListView), const Offset(0, 80));
      await tester.pumpAndSettle();
    }
    expect(_digestSvc.seen, isNotEmpty);
    expect(_digestSvc.seen.first.map((s) => s.taskId), contains('44'));
    expect(_digestSvc.seen.first.map((s) => s.taskId), isNot(contains('42')));
    // まだ見えていない上の行（42）は、その時点では送っていない
    expect(seenIds(), isNot(contains('42')));

    // 先頭まで戻すと残りの行も見え、その分だけ足す。見えた行を2回送らない
    await tester.fling(find.byType(ListView), const Offset(0, 6000), 4000);
    await tester.pumpAndSettle();
    expect(find.textContaining('ラピです'), findsOneWidget);
    await tester.drag(find.byType(ListView), const Offset(0, -300));
    await tester.pumpAndSettle();
    expect(seenIds()..sort(), ['42', '43', '44']);
    final all = [for (final batch in _digestSvc.seen) ...batch];
    expect(all, containsAll([(taskId: '42', cursor: 301), (taskId: '43', cursor: 312), (taskId: '44', cursor: 320)]));
  });

  testWidgets('nothing new and nothing to decide: no card, nothing marked seen', (tester) async {
    _digestSvc.digest = const CompanionDigest();
    await _pumpRapi(tester);
    expect(find.byKey(const ValueKey('rapi-digest')), findsNothing);
    expect(_digestSvc.seen, isEmpty);
  });

  testWidgets('a failed digest read shows no card and leaves the conversation usable',
      (tester) async {
    _digestSvc.fail = true;
    await _pumpRapi(tester);
    expect(_digestSvc.gets, 1);
    expect(find.byKey(const ValueKey('rapi-digest')), findsNothing);
    expect(find.byType(TextField), findsOneWidget);
    expect(_digestSvc.seen, isEmpty);
  });

  testWidgets('home shows the count and leads to ラピ, without marking anything seen',
      (tester) async {
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpHome(tester);
    expect(find.byKey(const ValueKey('home-digest-banner')), findsOneWidget);
    expect(find.text('あなたの判断を待っているタスクが2件あります'), findsOneWidget);
    expect(_digestSvc.seen, isEmpty);
  });

  final shotDir = Platform.environment['COMPANION_SCREENSHOT_DIR'];
  testWidgets('writes captures for visual review', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(390 * 3, 1500 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpRapi(tester);
    await _shoot(tester, '$shotDir/rapi_digest.png');
  }, skip: shotDir == null);

  testWidgets('writes captures of a long conversation (digest off screen, then scrolled to)',
      (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpRapi(tester, history: 30);
    await _shoot(tester, '$shotDir/rapi_digest_long_end.png');
    await tester.fling(find.byType(ListView), const Offset(0, 6000), 4000);
    await _shoot(tester, '$shotDir/rapi_digest_long_top.png');
  }, skip: shotDir == null);

  testWidgets('writes a capture of the home banner', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(390 * 3, 844 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await _pumpHome(tester);
    await _shoot(tester, '$shotDir/home_digest_banner.png');
  }, skip: shotDir == null);
}

Future<void> _pumpHome(WidgetTester tester) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      companionDigestServiceProvider.overrideWithValue(_digestSvc),
      connectionSettingsProvider.overrideWith((ref) => _LoadedSettings()),
      sseConnectionStateProvider.overrideWith((ref) => const Stream.empty()),
      taskListProvider.overrideWith((ref, filter) async => const []),
      executingTasksProvider.overrideWith((ref) async => const []),
      approvalListProvider.overrideWith((ref) async => const []),
      notificationListProvider.overrideWith((ref) async => const []),
    ],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: const MaterialApp(debugShowCheckedModeBanner: false, home: _AppLike(HomeScreen())),
    ),
  ));
  await tester.pumpAndSettle();
}

/// app.dart と同じく、build の中で companionDigestLifecycleProvider を保持する
/// （build 中に生成されても state の変更で落ちないことの確認を兼ねる）
class _AppLike extends ConsumerWidget {
  final Widget child;
  const _AppLike(this.child);
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(companionDigestLifecycleProvider);
    return child;
  }
}

Future<void> _shoot(WidgetTester tester, String path) async {
  await tester.pumpAndSettle();
  final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
  await tester.runAsync(() async {
    final image = await boundary.toImage(pixelRatio: 3);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final file = File(path);
    file.parent.createSync(recursive: true);
    file.writeAsBytesSync(bytes!.buffer.asUint8List());
  });
}

/// テスト用のフォントを実フォントに差し替える（キャプチャを読めるようにする）
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'MaterialIcons': ['$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'],
  };
  for (final entry in fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      final file = File(path);
      if (!file.existsSync()) continue;
      loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  }
}
