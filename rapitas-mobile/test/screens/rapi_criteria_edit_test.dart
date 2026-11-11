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

// 確定前の完了条件の利用者経路（G2 再レビュー必須指摘2、設計 3章段B）。
// 起票カード・計画カードの両方で：条件ごとの判定者のタグ・言い換えの案・ラピが補った案、
// 条件ごとに外せる（外した条件は送らない）、その場で文言を直せる（直すと判定と採点を
// サーバーに問い合わせ直す。サーバーの判定が正）。確定時は判定者のタグどおりに2列で送る。
//
// RAPI_SCREENSHOT_DIR を付けて走らせると、画面のキャプチャ（実フォント）も書き出す。

const _dentistItems = [
  RapiCriterionItem(
      text: '「歯医者を予約」の予約の日時と場所（医院・店など）が決まっている',
      verifier: RapiCriterionVerifier.user,
      supplemented: true),
  RapiCriterionItem(
      text: '予約が取れたことを、予約番号・予約確認の画面・確認メールのどれかで後から確かめられる形で残している',
      verifier: RapiCriterionVerifier.user,
      supplemented: true),
  RapiCriterionItem(
      text: '予約の日時を、予定表（カレンダーなど）に入れてある',
      verifier: RapiCriterionVerifier.user,
      supplemented: true),
];

RoadmapStep _step(String title, String action, List<RapiCriterionItem> items,
        {RapiCriteriaQuality quality = const RapiCriteriaQuality(score: 62, vagueCount: 1)}) =>
    RoadmapStep(
      title: title,
      description: '$action\n\n## 完了条件\n${items.map((i) => '- [ ] ${i.text}').join('\n')}',
      acceptanceCriteria: [for (final i in items) i.text],
      criteriaItems: items,
      criteriaQuality: quality,
    );

final _plan = RoadmapDraft(
  goal: '家計簿アプリに予算の通知を付ける',
  themeChoice: const RoadmapPlacement(kind: 'existing', id: 1, name: 'アプリ'),
  projectChoice: const RoadmapPlacement(kind: 'none'),
  steps: [
    _step('予算の通知を実装する', '月の予算を超えたら通知を出す', const [
      RapiCriterionItem(text: '予算を超えた支出を登録すると、通知が1件出る'),
      RapiCriterionItem(
          text: '通知の画面が見やすい',
          vagueTerm: '分かりやすい',
          vagueSuggestion: '「何を・どこに・どう表示するか」を書く（例：一覧の先頭に期限を表示する）'),
      RapiCriterionItem(
          text: '「予算の通知を実装する」の結果を本人が実際に操作して、求めていた動きだと確かめられる',
          verifier: RapiCriterionVerifier.user,
          supplemented: true),
    ]),
    _step('使い方を家族に伝える', '家族に通知の意味を伝える', const [
      RapiCriterionItem(
          text: '「使い方を家族に伝える」の結果（できたもの・決まったこと）を、本人が見て確かめられる',
          verifier: RapiCriterionVerifier.user,
          supplemented: true,
          generic: true),
    ], quality: const RapiCriteriaQuality(score: 35)),
  ],
);

class _CriteriaAssistant implements AssistantService {
  final List<List<String>> reviewed = [];
  bool reviewThrows = false;
  List<String>? createdJury;
  List<String>? createdUser;
  RoadmapDraft? committed;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async {
    if (text.startsWith('作る')) return const RoutedIntent(intent: 'create');
    if (text.startsWith('計画')) return const RoutedIntent(intent: 'roadmap');
    return const RoutedIntent();
  }

  @override
  Future<TaskDraft> createDraft(String text) async => TaskDraft(
        title: '歯医者を予約',
        themeId: '1',
        themeCandidates: const [RapiThemeRef(id: '1', name: 'くらし')],
        acceptanceCriteria: [for (final i in _dentistItems) i.text],
        acceptanceCriteriaFallback: true,
        criteriaItems: _dentistItems,
        criteriaQuality: const RapiCriteriaQuality(score: 45, vagueCount: 0),
      );

  /// サーバーの reviewCriteria と同じ考え方の、このテストで使う文だけの判定
  @override
  Future<({List<RapiCriterionItem> items, RapiCriteriaQuality? quality})> reviewCriteria({
    required String title,
    String? description,
    required List<String> criteria,
  }) async {
    reviewed.add(criteria);
    if (reviewThrows) throw const AssistantException('down');
    final errand = title.contains('予約');
    return (
      items: [
        for (final c in criteria)
          RapiCriterionItem(
            text: c,
            verifier: errand || c.contains('本人') || c.contains('家族')
                ? RapiCriterionVerifier.user
                : RapiCriterionVerifier.jury,
            vagueTerm: c.contains('見やす') ? '分かりやすい' : null,
            vagueSuggestion: c.contains('見やす') ? '「何を・どこに・どう表示するか」を書く' : null,
          ),
      ],
      quality: RapiCriteriaQuality(score: 50 + criteria.length * 5, isAdequate: false),
    );
  }

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
    createdJury = acceptanceCriteria;
    createdUser = userAcceptanceChecks;
    return '42';
  }

  @override
  Future<RoadmapDraft?> roadmapDraft(String text, {List<RoadmapAnswer> answers = const []}) async =>
      _plan;

  @override
  Future<RoadmapCommitResult> roadmapCommit(RoadmapDraft draft) async {
    committed = draft;
    return const RoadmapCommitResult(themeId: 1, taskIds: ['10', '11']);
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

const _boundaryKey = ValueKey('rapi-criteria-boundary');

void main() {
  late _CriteriaAssistant assistant;

  setUp(() => assistant = _CriteriaAssistant());

  Future<void> pumpScreen(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390 * 3, 2600 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(ProviderScope(
      key: UniqueKey(),
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        dictationServiceProvider.overrideWithValue(_IdleDictation()),
        taskListProvider.overrideWith((ref, filter) async => const <Task>[]),
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

  Future<void> rewrite(WidgetTester tester, String prefix, String text) async {
    await tester.tap(find.byKey(ValueKey('$prefix-edit')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byKey(ValueKey('$prefix-field')), text);
    await tester.tap(find.byKey(ValueKey('$prefix-save')));
    await tester.pumpAndSettle();
  }

  group('起票カード', () {
    testWidgets('生活タスクの条件は本人の判定。直すと問い合わせ直し、外した条件は送らない', (tester) async {
      await pumpScreen(tester);
      await send(tester, '作る：歯医者を予約');
      expect(find.text('本人が確かめる'), findsNWidgets(3));
      expect(find.text('陪審が確かめる'), findsNothing);
      expect(find.text('ラピが補った案'), findsNWidgets(3));
      expect(find.textContaining('予約番号'), findsOneWidget);
      // 文言はデスクトップへ誘導せず、その場で直せる
      expect(find.textContaining('デスクトップ'), findsNothing);
      expect(find.byKey(const ValueKey('rapi-criterion-0-edit')), findsOneWidget);

      await rewrite(tester, 'rapi-criterion-0', '10月20日の午前に、駅前の歯科で予約が取れている');
      expect(find.text('10月20日の午前に、駅前の歯科で予約が取れている'), findsOneWidget);
      expect(find.text('直した文'), findsOneWidget);
      // サーバーの判定と採点に置き換わる（採った3件で問い合わせ）
      expect(assistant.reviewed.last, hasLength(3));
      expect(find.text('仕様の採点 65/100（70以上が目安）'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('rapi-criterion-2-toggle')));
      await tester.pumpAndSettle();
      expect(find.text('2 / 3件を採用'), findsOneWidget);

      await tester.tap(find.text('この内容で作成'));
      await tester.pumpAndSettle();
      expect(assistant.createdJury, isEmpty);
      expect(assistant.createdUser, [
        '10月20日の午前に、駅前の歯科で予約が取れている',
        _dentistItems[1].text,
      ]);
    });

    testWidgets('「やめる」では文言を変えない', (tester) async {
      await pumpScreen(tester);
      await send(tester, '作る：歯医者を予約');
      await tester.tap(find.byKey(const ValueKey('rapi-criterion-1-edit')));
      await tester.pumpAndSettle();
      await tester.enterText(find.byKey(const ValueKey('rapi-criterion-1-field')), '別の文');
      await tester.tap(find.byKey(const ValueKey('rapi-criterion-1-cancel')));
      await tester.pumpAndSettle();
      expect(find.text('別の文'), findsNothing);
      expect(find.text(_dentistItems[1].text), findsOneWidget);
      expect(assistant.reviewed, isEmpty);
    });

    testWidgets('問い合わせに失敗したら、そう伝えて古い採点は出さない', (tester) async {
      assistant.reviewThrows = true;
      await pumpScreen(tester);
      await send(tester, '作る：歯医者を予約');
      await rewrite(tester, 'rapi-criterion-0', '予約が取れている');
      expect(find.textContaining('判定を確かめられませんでした'), findsOneWidget);
      expect(find.textContaining('仕様の採点'), findsNothing);
      expect(find.text('判定を確認中'), findsNothing);
    });
  });

  group('計画カード', () {
    testWidgets('手順ごとに判定者・言い換え・補った案・仮の文。説明文に条件を二重に出さない', (tester) async {
      await pumpScreen(tester);
      await send(tester, '計画：予算の通知');
      expect(find.byKey(const ValueKey('rapi-roadmap-step-1-criteria')), findsOneWidget);
      expect(find.byKey(const ValueKey('rapi-roadmap-step-2-criteria')), findsOneWidget);
      expect(find.text('陪審が確かめる'), findsNWidgets(2));
      expect(find.text('本人が確かめる'), findsNWidgets(2));
      expect(find.textContaining('「分かりやすい」は確かめにくい言葉です'), findsOneWidget);
      expect(find.text('仮の文'), findsOneWidget);
      expect(find.byKey(const ValueKey('rapi-step-2-criterion-generic-note')), findsOneWidget);
      // 説明は「## 完了条件」の節を除いたもの
      expect(find.text('月の予算を超えたら通知を出す'), findsOneWidget);
      expect(find.textContaining('## 完了条件'), findsNothing);
      // サーバーの criteriaQuality を読み捨てずに出す
      expect(find.text('仕様の採点 62/100（70以上が目安）・確かめにくい条件 1件'), findsOneWidget);
      expect(find.text('仕様の採点 35/100（70以上が目安）'), findsOneWidget);
    });

    testWidgets('外す・直すが commit に反映され、判定者どおり2列で送る', (tester) async {
      await pumpScreen(tester);
      await send(tester, '計画：予算の通知');
      await tester.tap(find.byKey(const ValueKey('rapi-step-1-criterion-1-toggle')));
      await tester.pumpAndSettle();
      await rewrite(tester, 'rapi-step-2-criterion-0', '家族2人に、通知が来たら支出を見直すと伝え、了解の返事をもらっている');
      expect(find.byKey(const ValueKey('rapi-step-2-criterion-generic-note')), findsNothing);

      await tester.tap(find.textContaining('この計画で作成する'));
      await tester.pumpAndSettle();
      final steps = assistant.committed!.steps;
      expect(steps[0].acceptanceCriteria, ['予算を超えた支出を登録すると、通知が1件出る']);
      expect(steps[0].userAcceptanceChecks,
          ['「予算の通知を実装する」の結果を本人が実際に操作して、求めていた動きだと確かめられる']);
      expect(steps[1].acceptanceCriteria, isEmpty);
      expect(steps[1].userAcceptanceChecks, ['家族2人に、通知が来たら支出を見直すと伝え、了解の返事をもらっている']);
      // 外した条件は送らない。説明文の「## 完了条件」は陪審の条件だけで作り直す（本人の条件は列だけ）
      expect(steps[0].toJson().toString(), isNot(contains('通知の画面が見やすい')));
      expect(steps[0].description,
          '月の予算を超えたら通知を出す\n\n## 完了条件\n- [ ] 予算を超えた支出を登録すると、通知が1件出る');
      expect(steps[1].description, isNot(contains('## 完了条件')));
      expect(steps[1].description, isNot(contains('家族2人に')));
    });

    testWidgets('ある手順の条件を全部外すと作成できない', (tester) async {
      await pumpScreen(tester);
      await send(tester, '計画：予算の通知');
      await tester.tap(find.byKey(const ValueKey('rapi-step-2-criterion-0-toggle')));
      await tester.pumpAndSettle();
      expect(find.text('完了条件を1つ以上残してください。'), findsOneWidget);
      await tester.tap(find.textContaining('この計画で作成する'));
      await tester.pumpAndSettle();
      expect(assistant.committed, isNull);
    });
  });

  final shotDir = Platform.environment['RAPI_SCREENSHOT_DIR'];
  testWidgets('writes captures for visual review', (tester) async {
    await _loadRealFonts();
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
    tester.view.physicalSize = const Size(390 * 3, 1100 * 3);
    await send(tester, '作る：歯医者を予約');
    await shoot('draft_errand_criteria');
    await tester.tap(find.byKey(const ValueKey('rapi-criterion-0-edit')));
    await tester.pumpAndSettle();
    await tester.enterText(
        find.byKey(const ValueKey('rapi-criterion-0-field')), '10月20日の午前に、駅前の歯科で予約が取れている');
    await shoot('draft_criterion_editing');
    await tester.tap(find.byKey(const ValueKey('rapi-criterion-0-save')));
    await tester.tap(find.byKey(const ValueKey('rapi-criterion-2-toggle')));
    await shoot('draft_criterion_edited');

    assistant = _CriteriaAssistant();
    await pumpScreen(tester);
    tester.view.physicalSize = const Size(390 * 3, 1500 * 3);
    await send(tester, '計画：予算の通知');
    await tester.tap(find.byKey(const ValueKey('rapi-step-1-criterion-1-toggle')));
    await shoot('roadmap_step_criteria');
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
