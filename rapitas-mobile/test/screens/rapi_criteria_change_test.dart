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

// 既存タスクの完了条件を変えるカード（設計 段E・§7 第2段階 項目3、nav42 直し回1 必須指摘4）。
// 相談中のタスクで「完了条件を変える」→ 今の条件を直す → 下書き（criteria-draft）→ 差分と理由 →
// 確定（task-criteria、下書きの版つき）→ 取り消し（revert）。409 は案内と作り直しの導線。
//
// RAPI_SCREENSHOT_DIR を付けて走らせると、画面のキャプチャ（実フォント）も書き出す。

class _CriteriaAssistant implements AssistantService {
  final List<String> calls = [];

  /// 今の完了条件（タスクごと）。確定・取り消しで書き換わる
  final Map<String, List<String>> criteria;

  /// 下書きに付ける「いま変えられない理由」
  String? blockedBy;

  /// 次の確定・取り消しで投げる例外
  Object? updateThrows;
  Object? revertThrows;

  RapiCriteriaDraft? lastConfirmed;
  int _revision = 1;
  final Map<int, List<String>> _undo = {};

  _CriteriaAssistant(this.criteria);

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent(intent: 'consult');

  @override
  Future<List<CopilotHistoryMessage>> copilotHistory(String taskId) async => const [];

  @override
  Future<CopilotReply> copilotChat(String message,
      {required String taskId, List<Map<String, String>> history = const []}) async {
    calls.add('consult:$taskId:$message');
    return const CopilotReply(content: '相談の返事');
  }

  @override
  Future<RapiCompanionDraft> companionDraft(String text, {String? taskId}) async =>
      const RapiCompanionDraft(matched: false);

  @override
  Future<RapiCriteriaDraft> criteriaDraft(String taskId,
      {required List<String> acceptanceCriteria, required String reason}) async {
    calls.add('draft:$taskId:${acceptanceCriteria.join('|')}:$reason');
    return RapiCriteriaDraft(
      taskId: taskId,
      title: 'ログインのバグを直す',
      criteriaRevision: 'rev-$_revision',
      before: criteria[taskId]!,
      after: acceptanceCriteria,
      reason: reason,
      blockedBy: blockedBy,
      blockedMessage: blockedBy == null ? null : 'いまは陪審が確認中なので、完了条件は変えられません。終わってから変えましょう。',
    );
  }

  @override
  Future<RapiCriteriaChangeResult> criteriaUpdate(RapiCriteriaDraft draft) async {
    calls.add('update:${draft.taskId}:${draft.criteriaRevision}:${draft.after.join('|')}');
    lastConfirmed = draft;
    final err = updateThrows;
    if (err != null) {
      updateThrows = null;
      throw err;
    }
    final before = criteria[draft.taskId]!;
    criteria[draft.taskId] = draft.after;
    _revision++;
    _undo[31] = before;
    return RapiCriteriaChangeResult(actionId: 31, before: before, after: draft.after);
  }

  @override
  Future<RapiCriteriaChangeResult> revertCriteria(int actionId) async {
    calls.add('revert:$actionId');
    final err = revertThrows;
    if (err != null) {
      revertThrows = null;
      throw err;
    }
    final after = criteria['7']!;
    criteria['7'] = _undo[actionId]!;
    return RapiCriteriaChangeResult(actionId: 32, before: after, after: criteria['7']!);
  }

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

const _base = ['ログインできる', 'エラーが出る', '画面が崩れない'];

Task _task(String id, List<String> criteria) => Task(
      id: id,
      title: 'ログインのバグを直す',
      status: 'in-progress',
      priority: 'medium',
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 8),
      acceptanceCriteria: criteria,
    );

const _boundaryKey = ValueKey('rapi-criteria-boundary');

void main() {
  late _CriteriaAssistant assistant;

  setUp(() => assistant = _CriteriaAssistant({'7': [..._base]}));

  Future<void> pumpScreen(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      key: UniqueKey(),
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        dictationServiceProvider.overrideWithValue(_IdleDictation()),
        taskListProvider
            .overrideWith((ref, filter) async => [_task('7', assistant.criteria['7']!)]),
        taskDetailProvider.overrideWith((ref, id) async => _task(id, assistant.criteria[id]!)),
      ],
      child: const MaterialApp(home: RepaintBoundary(key: _boundaryKey, child: RapiScreen())),
    ));
    await tester.pump();
  }

  Future<void> send(WidgetTester tester, String text) async {
    await tester.enterText(find.byType(TextField).last, text);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  Future<void> tapKey(WidgetTester tester, String key) async {
    final f = find.byKey(ValueKey(key));
    await tester.ensureVisible(f);
    await tester.pumpAndSettle();
    await tester.tap(f);
    await tester.pumpAndSettle();
  }

  /// 相談に入り「完了条件を変える」で直すカードを出し、言い換え・外す・足す・理由まで入れる
  Future<void> openAndEdit(WidgetTester tester) async {
    await pumpScreen(tester);
    await send(tester, '相談：ログインの件');
    await tapKey(tester, 'rapi-consult-task-7');
    // 相談に入ると保留していた発言が相談として送られる。ここからはカードの送信だけを見る
    assistant.calls.clear();
    await tapKey(tester, 'rapi-consult-criteria');
    expect(find.text('完了条件をどう変えますか'), findsOneWidget);
    for (final c in _base) {
      expect(find.text(c), findsOneWidget);
    }
    // 変えるまでは下書きを作れない
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey('rapi-criteria-draft'))).onPressed,
        isNull);

    await tapKey(tester, 'rapi-criteria-change-1-edit');
    await tester.enterText(
        find.byKey(const ValueKey('rapi-criteria-change-1-field')), '誤ったパスワードでは案内が出る');
    await tapKey(tester, 'rapi-criteria-change-1-save');
    await tapKey(tester, 'rapi-criteria-change-2-toggle');
    await tapKey(tester, 'rapi-criteria-add');
    await tester.enterText(find.byKey(const ValueKey('rapi-criteria-add-field')), '3回まちがえると鍵がかかる');
    await tapKey(tester, 'rapi-criteria-add-save');
    final reason = find.byKey(const ValueKey('rapi-criteria-reason'));
    await tester.ensureVisible(reason);
    await tester.enterText(reason, '鍵の仕様が決まった');
    await tester.pumpAndSettle();
  }

  testWidgets('直す → 下書き（書き込まない）→ 差分と理由 → 確定（下書きの版）→ 取り消し', (tester) async {
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    expect(assistant.calls, [
      'draft:7:ログインできる|誤ったパスワードでは案内が出る|3回まちがえると鍵がかかる:鍵の仕様が決まった',
    ]);
    // 下書きでは何も変わらない
    expect(assistant.criteria['7'], _base);
    expect(find.text('この内容で完了条件を変えますか'), findsOneWidget);
    expect(find.text('言い換え'), findsOneWidget);
    expect(find.text('消す'), findsOneWidget);
    expect(find.text('足す'), findsOneWidget);
    expect(find.text('鍵の仕様が決まった'), findsOneWidget);

    await tapKey(tester, 'rapi-criteria-apply');
    expect(assistant.calls.last,
        'update:7:rev-1:ログインできる|誤ったパスワードでは案内が出る|3回まちがえると鍵がかかる');
    expect(assistant.lastConfirmed!.reason, '鍵の仕様が決まった');
    expect(find.text('完了条件を変えました'), findsOneWidget);
    // 判断の受け口（相談・copilot）には何も送っていない
    expect(assistant.calls.where((c) => c.startsWith('consult')), isEmpty);

    await tapKey(tester, 'rapi-criteria-revert');
    expect(assistant.calls.last, 'revert:31');
    expect(assistant.criteria['7'], _base);
    expect(find.text('元に戻しました'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-criteria-revert')), findsNothing);
  });

  testWidgets('「直す」で欄に戻り、「やめる」は何も送らずカードを下げる', (tester) async {
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    await tapKey(tester, 'rapi-criteria-back');
    expect(find.text('完了条件をどう変えますか'), findsOneWidget);
    await tapKey(tester, 'rapi-criteria-cancel');
    expect(find.text('完了条件をどう変えますか'), findsNothing);
    expect(assistant.calls.where((c) => c.startsWith('update')), isEmpty);
  });

  testWidgets('409 criteria_changed_since：上書きせず案内し、最新の条件から作り直せる', (tester) async {
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    // 下書きのあとで、別の画面から条件が変わった
    assistant.criteria['7'] = ['ログインできる', '画面から足した条件'];
    assistant.updateThrows = const AssistantException('criteria_changed_since',
        statusCode: 409, message: '完了条件は、この画面を開いたあとで変わっています。');
    await tapKey(tester, 'rapi-criteria-apply');
    expect(find.textContaining('この下書きを作ったあとで、完了条件が変わりました'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-criteria-apply')), findsNothing);
    expect(find.text('最新の条件で作り直す'), findsOneWidget);
    // 画面から変えた条件はそのまま
    expect(assistant.criteria['7'], ['ログインできる', '画面から足した条件']);

    await tapKey(tester, 'rapi-criteria-rebuild');
    expect(find.text('完了条件をどう変えますか'), findsOneWidget);
    expect(find.text('画面から足した条件'), findsOneWidget);
    expect(find.textContaining('最新の完了条件を読み直しました'), findsOneWidget);
    // 理由は引き継ぐ
    expect(find.text('鍵の仕様が決まった'), findsOneWidget);
  });

  testWidgets('判定中（blockedBy）は理由を出し、確定を出さない。409 review_in_progress も案内する', (tester) async {
    assistant.blockedBy = 'review_in_progress';
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    expect(find.byKey(const ValueKey('rapi-criteria-blocked')), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-criteria-apply')), findsNothing);

    assistant.blockedBy = null;
    await tapKey(tester, 'rapi-criteria-cancel');
    await tapKey(tester, 'rapi-consult-criteria');
    await tapKey(tester, 'rapi-criteria-change-0-toggle');
    final reason = find.byKey(const ValueKey('rapi-criteria-reason'));
    await tester.ensureVisible(reason);
    await tester.enterText(reason, '要らなくなった');
    await tester.pumpAndSettle();
    await tapKey(tester, 'rapi-criteria-draft');
    assistant.updateThrows = const AssistantException('review_in_progress',
        statusCode: 409, message: 'いまは陪審が確認中なので、完了条件は変えられません。');
    await tapKey(tester, 'rapi-criteria-apply');
    expect(find.text('いまは陪審が確認中なので、完了条件は変えられません。'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-criteria-apply')), findsNothing);
    expect(find.byKey(const ValueKey('rapi-criteria-rebuild')), findsNothing);
    expect(assistant.criteria['7'], _base);
  });

  testWidgets('取り消しが 409 なら戻さず、その旨を出す', (tester) async {
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    await tapKey(tester, 'rapi-criteria-apply');
    assistant.revertThrows =
        const AssistantException('criteria_changed_since', statusCode: 409);
    await tapKey(tester, 'rapi-criteria-revert');
    expect(find.textContaining('その後に完了条件が変わったため、元に戻しませんでした'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-criteria-revert')), findsNothing);
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
    await send(tester, '相談：ログインの件');
    await tapKey(tester, 'rapi-consult-task-7');
    await shoot('criteria_consult_band');
    await tapKey(tester, 'rapi-consult-criteria');
    await shoot('criteria_open');

    assistant = _CriteriaAssistant({'7': [..._base]});
    await openAndEdit(tester);
    await shoot('criteria_editing');
    await tapKey(tester, 'rapi-criteria-draft');
    await shoot('criteria_proposed');
    await tapKey(tester, 'rapi-criteria-apply');
    await shoot('criteria_applied');
    await tapKey(tester, 'rapi-criteria-revert');
    await shoot('criteria_reverted');

    assistant = _CriteriaAssistant({'7': [..._base]});
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    assistant.updateThrows = const AssistantException('criteria_changed_since', statusCode: 409);
    await tapKey(tester, 'rapi-criteria-apply');
    await shoot('criteria_conflict');

    assistant = _CriteriaAssistant({'7': [..._base]})..blockedBy = 'review_in_progress';
    await openAndEdit(tester);
    await tapKey(tester, 'rapi-criteria-draft');
    await shoot('criteria_blocked');
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
