import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

// 計画（roadmap）カードの表示：質問（推奨が初期選択）→ 作り直し → 最終確認 → 作成結果、
// タスク一覧への導線、失敗時の表示。

const _sketch = RoadmapDraft(
  goal: '年内に英検2級に合格する',
  themeChoice: RoadmapPlacement(kind: 'new', name: '英語学習', reason: '合う既存テーマがないため'),
  projectChoice: RoadmapPlacement(kind: 'none'),
  questions: [
    RoadmapQuestion(
      question: '1日に使える時間は？',
      options: ['30分', '1時間', '2時間'],
      recommended: '1時間',
      recommendedReason: '続けやすいため',
    ),
  ],
  steps: [RoadmapStep(title: '過去問を1回分解く', description: '現状の点数を知る')],
);

const _final = RoadmapDraft(
  goal: '年内に英検2級に合格する',
  themeChoice: RoadmapPlacement(kind: 'new', name: '英語学習'),
  projectChoice: RoadmapPlacement(kind: 'existing', id: 4, name: '資格'),
  deadline: '2026-12-20',
  steps: [
    RoadmapStep(title: '過去問を1回分解く', description: '完了：採点まで', dueDate: '2026-11-15'),
    RoadmapStep(title: '単語を毎日2時間', description: '完了：単語帳を1周'),
  ],
);

class _RoadmapAssistant implements AssistantService {
  final List<RoadmapDraft?> drafts = [_sketch, _final];
  final List<List<RoadmapAnswer>> answered = [];
  final List<RoadmapDraft> committed = [];
  RoadmapCommitResult result =
      const RoadmapCommitResult(themeId: 12, projectId: 4, taskIds: ['101', '102']);
  Object? commitError;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent(intent: 'roadmap');

  @override
  Future<RoadmapDraft?> roadmapDraft(String text, {List<RoadmapAnswer> answers = const []}) async {
    answered.add(answers);
    return drafts.length > 1 ? drafts.removeAt(0) : drafts.first;
  }

  @override
  Future<RoadmapCommitResult> roadmapCommit(RoadmapDraft draft) async {
    committed.add(draft);
    if (commitError != null) throw commitError!;
    return result;
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

void main() {
  late _RoadmapAssistant assistant;

  setUp(() => assistant = _RoadmapAssistant());

  Future<void> sendRoadmap(WidgetTester tester) async {
    tester.view.physicalSize = const Size(390 * 3, 1600 * 3);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    final router = GoRouter(routes: [
      GoRoute(path: '/', builder: (context, state) => const RapiScreen()),
      GoRoute(path: '/tasks', builder: (context, state) => const Scaffold(body: Text('タスク一覧の画面'))),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        dictationServiceProvider.overrideWithValue(_IdleDictation()),
        themeListProvider.overrideWith((ref) async => <TaskTheme>[]),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextField), '年内に英検2級を取りたい');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  ChoiceChip chip(WidgetTester tester, String option) =>
      tester.widget<ChoiceChip>(find.byKey(ValueKey('rapi-roadmap-q0-$option')));

  testWidgets('質問あり：目標・置き場所・選択肢（推奨が初期選択）・作り直すボタン。作成ボタンは出ない',
      (tester) async {
    await sendRoadmap(tester);

    expect(find.text('計画の下書き'), findsOneWidget);
    expect(find.text('年内に英検2級に合格する'), findsOneWidget);
    expect(find.text('英語学習'), findsOneWidget);
    expect(find.text('新規作成'), findsOneWidget);
    expect(find.text('Q1. 1日に使える時間は？'), findsOneWidget);
    expect(chip(tester, '1時間').selected, isTrue);
    expect(chip(tester, '30分').selected, isFalse);
    expect(find.textContaining('おすすめ：1時間'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-refine')), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-commit')), findsNothing);
    expect(find.textContaining('デスクトップ版'), findsNothing);
  });

  testWidgets('選んで作り直す → 最終確認 → 作成 → 結果 → タスク一覧へ', (tester) async {
    await sendRoadmap(tester);

    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-q0-2時間')));
    await tester.pump();
    expect(chip(tester, '2時間').selected, isTrue);
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-refine')));
    await tester.pumpAndSettle();

    expect(assistant.answered.last.single.answer, '2時間');
    expect(find.text('この計画で作成しますか'), findsOneWidget);
    expect(find.text('資格'), findsOneWidget);
    expect(find.text('既存'), findsOneWidget);
    expect(find.text('2026/12/20'), findsOneWidget);
    expect(find.text('決めたこと'), findsOneWidget);
    expect(find.text('作成するタスク（2件）'), findsOneWidget);
    expect(find.text('単語を毎日2時間'), findsOneWidget);
    expect(find.text('完了：単語帳を1周'), findsOneWidget);
    expect(find.text('この計画で作成する（2件）'), findsOneWidget);
    expect(assistant.committed, isEmpty);

    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-commit')));
    await tester.pumpAndSettle();

    expect(identical(assistant.committed.single, _final), isTrue);
    expect(find.text('計画を作成しました'), findsOneWidget);
    expect(find.text('タスクを2件作成しました。'), findsOneWidget);
    expect(find.text('テーマ：「英語学習」を新しく作りました'), findsOneWidget);
    expect(find.text('プロジェクト：「資格」'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-commit')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-open-tasks')));
    await tester.pumpAndSettle();
    expect(find.text('タスク一覧の画面'), findsOneWidget);
  });

  testWidgets('途中で止まったら、止まった位置と作られていない件数を出す', (tester) async {
    assistant.result = const RoadmapCommitResult(themeId: 12, taskIds: ['101'], failedAfter: 1);
    await sendRoadmap(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-refine')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-commit')));
    await tester.pumpAndSettle();

    expect(find.text('計画を途中まで作成しました'), findsOneWidget);
    expect(find.text('タスクを1件作成しました。'), findsOneWidget);
    expect(find.textContaining('1件目まで作成したところで止まりました'), findsOneWidget);
    expect(find.textContaining('「単語を毎日2時間」から'), findsOneWidget);
  });

  testWidgets('作成の応答が失われたら作成ボタンを出さず、タスク一覧で確かめてもらう', (tester) async {
    assistant.commitError = const AssistantTimeoutException(DioExceptionType.receiveTimeout);
    await sendRoadmap(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-refine')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-commit')));
    await tester.pumpAndSettle();

    expect(find.text('作成できたか確かめられませんでした'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-commit')), findsNothing);
    expect(find.byKey(const ValueKey('rapi-roadmap-open-tasks')), findsOneWidget);
  });

  testWidgets('通信エラー（connectionError）でも作成済みかもしれないので、作成ボタンを出さない', (tester) async {
    assistant.commitError = DioException(
        requestOptions: RequestOptions(path: '/assistant/roadmap/commit'),
        type: DioExceptionType.connectionError);
    await sendRoadmap(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-refine')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-commit')));
    await tester.pumpAndSettle();

    expect(find.text('作成できたか確かめられませんでした'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-commit')), findsNothing);
    expect(find.byKey(const ValueKey('rapi-roadmap-open-tasks')), findsOneWidget);
    expect(assistant.committed, hasLength(1));
  });

  testWidgets('3xx（302）で失敗したら断られたとは言えないので、作成ボタンを出さない', (tester) async {
    assistant.commitError = const AssistantException('http_302', statusCode: 302);
    await sendRoadmap(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-refine')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-commit')));
    await tester.pumpAndSettle();

    expect(find.text('作成できたか確かめられませんでした'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-commit')), findsNothing);
    expect(find.byKey(const ValueKey('rapi-roadmap-open-tasks')), findsOneWidget);
    expect(assistant.committed, hasLength(1));
  });

  testWidgets('サーバーが断ったら最終確認のまま案内し、作成ボタンを残す', (tester) async {
    assistant.commitError = const AssistantException('validation', statusCode: 422);
    await sendRoadmap(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-refine')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rapi-roadmap-commit')));
    await tester.pumpAndSettle();

    expect(find.text('この計画で作成しますか'), findsOneWidget);
    expect(find.textContaining('受け付けられませんでした'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-roadmap-commit')), findsOneWidget);
  });

  testWidgets('「やめる」でカードを下げる', (tester) async {
    await sendRoadmap(tester);
    await tester.tap(find.text('やめる'));
    await tester.pumpAndSettle();

    expect(find.text('計画の下書き'), findsNothing);
  });
}
