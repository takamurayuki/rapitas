import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

// 手動の「伴走して」「伴走をやめて」の利用者経路（G2 レビュー必須指摘2、設計 4.3・第1段階の条件5）。
// 相談で言う → 確認カード → 押すと companion/start・stop（confirmed: true）。
// 相談モードの外では、対象のタスクを選ぶカードを挟む。伴走の依頼でない「伴走」はふつうの相談へ。
//
// RAPI_SCREENSHOT_DIR を付けて走らせると、画面のキャプチャ（実フォント）も書き出す。

class _CompanionAssistant implements AssistantService {
  final List<String> calls = [];

  /// 伴走中のタスク
  final Set<String> active = {};

  /// 次の apply で投げる例外
  Object? applyThrows;

  static const _titles = {'7': 'ログインのバグを直す', '9': '設計書を書く'};

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    calls.add('route:$text');
    if (text.startsWith('相談')) return const RoutedIntent(intent: 'consult');
    if (text.startsWith('作る')) return const RoutedIntent(intent: 'create');
    return const RoutedIntent();
  }

  @override
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async => const [];

  @override
  Future<CopilotReply> copilotChat(String message,
      {required String taskId, List<Map<String, String>> history = const []}) async {
    calls.add('consult:$taskId:$message');
    return CopilotReply(content: '「$message」への相談の返事');
  }

  @override
  Future<CopilotReply> chat(String message, {List<Map<String, String>> history = const []}) async {
    calls.add('chat:$message');
    return const CopilotReply(content: '一般の返事');
  }

  @override
  Future<RapiCompanionDraft> companionDraft(String text, {String? taskId}) async {
    calls.add('draft:$text:${taskId ?? '-'}');
    // サーバーの companion-intent と同じ見分け（このテストで使う文だけ）
    final action = text.contains('やめ')
        ? RapiCompanionAction.stop
        : text.contains('伴走して')
            ? RapiCompanionAction.start
            : null;
    if (action == null) return const RapiCompanionDraft(matched: false);
    if (taskId == null) {
      return RapiCompanionDraft(matched: true, action: action, needsTask: true);
    }
    final isActive = active.contains(taskId);
    final unavailable = action == RapiCompanionAction.start
        ? (isActive ? 'already_active' : null)
        : (isActive ? null : 'not_active');
    return RapiCompanionDraft(
      matched: true,
      action: action,
      unavailable: unavailable,
      proposal: RapiCompanionProposal(
          action: action, taskId: taskId, title: _titles[taskId] ?? '?', active: isActive),
    );
  }

  @override
  Future<void> companionApply(RapiCompanionAction action, String taskId) async {
    calls.add('apply:${action.name}:$taskId');
    final err = applyThrows;
    if (err != null) {
      applyThrows = null;
      throw err;
    }
    if (action == RapiCompanionAction.start) {
      active.add(taskId);
    } else {
      active.remove(taskId);
    }
  }

  @override
  Future<TaskDraft> createDraft(String text) async => const TaskDraft(
        title: '設定画面を作る',
        themeId: '1',
        themeCandidates: [RapiThemeRef(id: '1', name: 'アプリ')],
        acceptanceCriteria: [
          '設定画面が使いやすい',
          '保存ボタンを押すと値がサーバーに保存される',
          '「設定画面を作る」の結果を本人が実際に見て、求めていたものだと確かめられる',
        ],
        criteriaItems: [
          RapiCriterionItem(
              text: '設定画面が使いやすい',
              vagueTerm: '使いやすい',
              vagueSuggestion: '「◯タップ（◯手順）以内で〜できる」のように、操作の数で書く'),
          RapiCriterionItem(text: '保存ボタンを押すと値がサーバーに保存される'),
          RapiCriterionItem(
              text: '「設定画面を作る」の結果を本人が実際に見て、求めていたものだと確かめられる',
              verifier: RapiCriterionVerifier.user,
              supplemented: true),
        ],
        criteriaQuality: RapiCriteriaQuality(score: 40, vagueCount: 1),
      );

  List<String>? createdWith;

  @override
  Future<String?> createTask({
    required String title,
    required String themeId,
    String? description,
    String? priority,
    String? dueDate,
    double? estimatedHours,
    List<String> acceptanceCriteria = const [],
    List<String> userAcceptanceChecks = const [],
  }) async {
    createdWith = acceptanceCriteria;
    createdUserChecks = userAcceptanceChecks;
    return '42';
  }

  List<String>? createdUserChecks;

  @override
  Future<({List<RapiCriterionItem> items, RapiCriteriaQuality? quality})> reviewCriteria({
    required String title,
    String? description,
    required List<String> criteria,
  }) async =>
      (
        items: [
          for (final c in criteria)
            RapiCriterionItem(
                text: c,
                verifier: c.contains('本人')
                    ? RapiCriterionVerifier.user
                    : RapiCriterionVerifier.jury),
        ],
        quality: const RapiCriteriaQuality(score: 55, isAdequate: false),
      );

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
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

Task _t(String id, String title, String status, int day) => Task(
      id: id,
      title: title,
      status: status,
      priority: 'medium',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, day),
    );

final _tasks = [
  _t('7', 'ログインのバグを直す', 'in-progress', 8),
  _t('9', '設計書を書く', 'todo', 5),
];

const _boundaryKey = ValueKey('rapi-companion-boundary');

void main() {
  late _CompanionAssistant assistant;

  setUp(() => assistant = _CompanionAssistant());

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      key: UniqueKey(),
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        dictationServiceProvider.overrideWithValue(_IdleDictation()),
        taskListProvider.overrideWith((ref, filter) async => _tasks),
        taskDetailProvider.overrideWith((ref, id) async => _tasks.firstWhere((t) => t.id == id)),
      ],
      child: const MaterialApp(
          home: RepaintBoundary(key: _boundaryKey, child: RapiScreen())),
    ));
    await tester.pump();
  }

  Future<void> send(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField).last, text);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  Future<void> enterConsult(WidgetTester tester, String taskId) async {
    await send(tester, '相談：見てほしい');
    await tester.tap(find.byKey(ValueKey('rapi-consult-task-$taskId')));
    await tester.pumpAndSettle();
  }

  testWidgets('相談中に「伴走して」：相談には送らず確認カード。押すと start、結果を出す', (tester) async {
    await pumpScreen(tester);
    await enterConsult(tester, '7');
    assistant.calls.clear();

    await send(tester, 'このタスクを伴走して');
    expect(find.text('このタスクを伴走しますか'), findsOneWidget);
    expect(find.text('伴走を始める'), findsOneWidget);
    // 押すまで何も書き込まない。相談（copilot）にも送らない
    expect(assistant.calls, ['draft:このタスクを伴走して:7']);
    expect(assistant.active, isEmpty);

    await tester.tap(find.byKey(const ValueKey('rapi-companion-apply')));
    await tester.pumpAndSettle();
    expect(assistant.calls.last, 'apply:start:7');
    expect(assistant.active, {'7'});
    expect(find.text('伴走を始めました'), findsOneWidget);
    expect(find.text('タスクを開く'), findsOneWidget);
  });

  testWidgets('続けて「伴走をやめて」：stop の確認カード → 押すと閉じる（条件5の往復）', (tester) async {
    await pumpScreen(tester);
    await enterConsult(tester, '7');
    await send(tester, '伴走して');
    await tester.tap(find.byKey(const ValueKey('rapi-companion-apply')));
    await tester.pumpAndSettle();

    await send(tester, '伴走をやめて');
    expect(find.text('このタスクの伴走をやめますか'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('rapi-companion-apply')));
    await tester.pumpAndSettle();
    expect(assistant.calls.last, 'apply:stop:7');
    expect(assistant.active, isEmpty);
    expect(find.text('伴走をやめました'), findsOneWidget);
  });

  testWidgets('伴走の依頼でない「伴走」は、ふつうの相談として送る', (tester) async {
    await pumpScreen(tester);
    await enterConsult(tester, '7');
    assistant.calls.clear();

    await send(tester, '伴走ってなに？');
    expect(assistant.calls, ['draft:伴走ってなに？:7', 'consult:7:伴走ってなに？']);
    expect(find.text('「伴走ってなに？」への相談の返事'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-companion-apply')), findsNothing);
  });

  testWidgets('既に伴走中なら、カードを出さず理由を返す', (tester) async {
    assistant.active.add('7');
    await pumpScreen(tester);
    await enterConsult(tester, '7');
    await send(tester, '伴走して');
    expect(find.textContaining('「ログインのバグを直す」はもう伴走しています'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-companion-apply')), findsNothing);
  });

  testWidgets('相談の外で「伴走をやめて」：タスクを選ぶカード → 選ぶと確認カード', (tester) async {
    assistant.active.add('9');
    await pumpScreen(tester);
    await send(tester, '伴走をやめて');
    // 振り分け（route）には送らない
    expect(assistant.calls, ['draft:伴走をやめて:-']);
    expect(find.text('どのタスクの伴走をやめますか'), findsOneWidget);
    expect(find.text('選ぶと確認カードを出します（まだ変更しません）。'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-consult-task-9')));
    await tester.pumpAndSettle();
    expect(assistant.calls.last, 'draft:伴走をやめて:9');
    // 相談モードには入らない
    expect(find.byKey(const ValueKey('rapi-consult-band')), findsNothing);
    expect(find.text('「設計書を書く」の伴走について確かめます'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('rapi-companion-apply')));
    await tester.pumpAndSettle();
    expect(assistant.calls.last, 'apply:stop:9');
    expect(find.text('伴走をやめました'), findsOneWidget);
  });

  testWidgets('「やめる」はカードを下げるだけで何も送らない', (tester) async {
    await pumpScreen(tester);
    await enterConsult(tester, '7');
    await send(tester, '伴走して');
    await tester.tap(find.byKey(const ValueKey('rapi-companion-cancel')));
    await tester.pumpAndSettle();
    expect(find.text('このタスクを伴走しますか'), findsNothing);
    expect(assistant.calls.where((c) => c.startsWith('apply')), isEmpty);
  });

  testWidgets('既に反映済み（409 already_active）は、望んだ結果として扱う', (tester) async {
    await pumpScreen(tester);
    await enterConsult(tester, '7');
    await send(tester, '伴走して');
    assistant.applyThrows = const AssistantException('already_active', statusCode: 409);
    await tester.tap(find.byKey(const ValueKey('rapi-companion-apply')));
    await tester.pumpAndSettle();
    expect(find.text('伴走を始めました'), findsOneWidget);
  });

  testWidgets('起票カード：完了条件ごとに判定者・言い換えの案・採点。外した条件は送らない', (tester) async {
    await pumpScreen(tester);
    await send(tester, '作る：設定画面');
    expect(find.text('陪審が確かめる'), findsNWidgets(2));
    expect(find.text('本人が確かめる'), findsOneWidget);
    expect(find.text('ラピが補った案'), findsOneWidget);
    expect(find.textContaining('「使いやすい」は確かめにくい言葉です'), findsOneWidget);
    expect(find.text('仕様の採点 40/100（70以上が目安）・確かめにくい条件 1件'), findsOneWidget);
    expect(find.text('3 / 3件を採用'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-criterion-0')));
    await tester.pumpAndSettle();
    expect(find.text('2 / 3件を採用'), findsOneWidget);
    await tester.tap(find.text('この内容で作成'));
    await tester.pumpAndSettle();
    // 判定者のタグどおりに2列で送る（設計 4.1 案1）
    expect(assistant.createdWith, ['保存ボタンを押すと値がサーバーに保存される']);
    expect(assistant.createdUserChecks, [
      '「設定画面を作る」の結果を本人が実際に見て、求めていたものだと確かめられる',
    ]);
  });

  final shotDir = Platform.environment['RAPI_SCREENSHOT_DIR'];
  testWidgets('writes captures for visual review', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(390 * 3, 1500 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    Future<void> shoot(String name) async {
      await tester.pumpAndSettle();
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$shotDir/rapi_$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    await pumpScreen(tester);
    await enterConsult(tester, '7');
    await send(tester, 'このタスクを伴走して');
    await shoot('companion_start_proposed');
    await tester.tap(find.byKey(const ValueKey('rapi-companion-apply')));
    await send(tester, '伴走をやめて');
    await shoot('companion_started_then_stop_proposed');

    assistant = _CompanionAssistant();
    await pumpScreen(tester);
    await send(tester, '伴走して');
    await shoot('companion_pick_task');

    assistant = _CompanionAssistant();
    await pumpScreen(tester);
    await send(tester, '作る：設定画面');
    await tester.tap(find.byKey(const ValueKey('rapi-criterion-0')));
    await shoot('draft_criteria');
  }, skip: shotDir == null);
}

/// Replaces the test font with real ones so the PNGs are readable.
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'MaterialIcons': [
      '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ],
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
