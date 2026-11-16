import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

// 片付け（tidy）カードの表示：条件フォーム（デスクトップと同じ項目・初期値）→ 候補一覧（全部チェック済み）、
// 文章で選ぶ経路の候補（理由・検討件数）、チェックの切り替え、削除 → 取り消し、一部失敗の表示。

final _matches = [
  TidyItem(id: '11', title: '古い調査メモ', status: 'cancelled', updatedAt: DateTime.utc(2026, 5, 1)),
  TidyItem(id: '12', title: '中止した企画', status: 'cancelled', updatedAt: DateTime.utc(2026, 6, 10)),
  TidyItem(id: '13', title: '重複したバグ票', status: 'cancelled', updatedAt: DateTime.utc(2026, 7, 20)),
];

class _TidyAssistant implements AssistantService {
  final List<TidyFilter> filters = [];
  final List<String> drafts = [];
  final List<List<String>> deleted = [];
  final List<int> restored = [];
  DeleteFilterResult filterResult =
      DeleteFilterResult(matches: _matches, total: 3, excludedProtected: 1);
  DeleteDraftResult draftResult = const DeleteDraftResult(
    candidates: [
      TidyItem(id: '21', title: 'ログイン画面の調査（重複）', status: 'todo', reason: '同名のタスクが別にあるため'),
      TidyItem(id: '22', title: '終わった調査', status: 'done', reason: '完了済みの調査タスクのため'),
    ],
    considered: 60,
    unclear: ['「古いもの」がいつより前か分かりませんでした'],
  );
  TaskDeleteRun Function(List<String> ids)? runFor;

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent(intent: 'tidy');

  @override
  Future<DeleteFilterResult> deleteFilter(TidyFilter filter) async {
    filters.add(filter);
    return filterResult;
  }

  @override
  Future<DeleteDraftResult> deleteDraft(String text) async {
    drafts.add(text);
    return draftResult;
  }

  @override
  Future<TaskDeleteRun> deleteTasks(List<String> taskIds,
      {void Function(int done, int of)? onProgress}) async {
    deleted.add(taskIds);
    onProgress?.call(1, 1);
    return runFor?.call(taskIds) ??
        TaskDeleteRun(results: [
          for (final id in taskIds)
            TaskDeletion(taskId: id, outcome: 'deleted', trashId: int.parse(id) + 1000),
        ]);
  }

  @override
  Future<void> restoreFromTrash(int trashId) async => restored.add(trashId);

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
  late _TidyAssistant assistant;

  setUp(() => assistant = _TidyAssistant());

  Future<void> sendTidy(WidgetTester tester, [String text = '中止したタスクを片付けて']) async {
    tester.view.physicalSize = const Size(390 * 3, 2200 * 3);
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
        themeListProvider.overrideWith((ref) async => [
              TaskTheme(id: '7', name: '仕事', color: '#6366F1'),
            ]),
        taskListProvider.overrideWith((ref, filter) async => <Task>[]),
        taskDetailProvider.overrideWith((ref, id) async => throw StateError('unused')),
      ],
      child: MaterialApp.router(routerConfig: router),
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextField), text);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  ChoiceChip chip(WidgetTester tester, String key) =>
      tester.widget<ChoiceChip>(find.byKey(ValueKey(key)));
  Checkbox box(WidgetTester tester, String id) => tester.widget<Checkbox>(
      find.descendant(of: find.byKey(ValueKey('rapi-tidy-item-$id')), matching: find.byType(Checkbox)));

  testWidgets('条件フォーム：出し方のチップ・テーマ・状態（中止が初期選択）・最終更新（90日）', (tester) async {
    await sendTidy(tester);

    expect(find.text('片付けるタスクを選ぶ'), findsOneWidget);
    expect(chip(tester, 'rapi-tidy-how-condition').selected, isTrue);
    expect(chip(tester, 'rapi-tidy-how-text').selected, isFalse);
    expect(find.text('すべてのテーマ'), findsOneWidget);
    expect(chip(tester, 'rapi-tidy-status-cancelled').selected, isTrue);
    expect(chip(tester, 'rapi-tidy-status-done').selected, isFalse);
    expect(find.text('90日以上前'), findsOneWidget);
    expect(find.text('該当するタスクを見る'), findsOneWidget);
    expect(find.textContaining('デスクトップ版'), findsNothing);
    expect(assistant.filters, isEmpty);
  });

  testWidgets('条件で探す → 件数・保護の除外・チェック済みの一覧 → チェックを外すと件数が変わる', (tester) async {
    await sendTidy(tester);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-status-done')));
    await tester.pump();
    expect(chip(tester, 'rapi-tidy-status-done').selected, isTrue);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-search')));
    await tester.pumpAndSettle();

    expect(assistant.filters.single.statuses, ['cancelled', 'done']);
    expect(find.text('このタスクを削除しますか'), findsOneWidget);
    expect(find.text('3件が該当しました'), findsOneWidget);
    expect(find.text('保護された1件は対象外です'), findsOneWidget);
    expect(find.text('古い調査メモ'), findsOneWidget);
    expect(find.textContaining('2026/05/01 更新'), findsOneWidget);
    for (final id in ['11', '12', '13']) {
      expect(box(tester, id).value, isTrue);
    }
    expect(find.text('削除する（3件）'), findsOneWidget);

    await tester.tap(find.text('中止した企画'));
    await tester.pump();
    expect(box(tester, '12').value, isFalse);
    expect(find.text('削除する（2件）'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-all')));
    await tester.pump();
    expect(find.text('削除する（3件）'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-all')));
    await tester.pump();
    expect(find.text('削除する（0件）'), findsOneWidget);
    expect(
        tester.widget<ButtonStyleButton>(find.byKey(const ValueKey('rapi-tidy-delete'))).onPressed,
        isNull);
  });

  testWidgets('文章で選ぶ：発言をそのまま送り、理由・検討件数・判断できなかったことを出す', (tester) async {
    await sendTidy(tester, '重複しているタスクを消して');

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-how-text')));
    await tester.pump();
    expect(find.text('重複しているタスクを消して'), findsNWidgets(2)); // 発言と依頼の文
    expect(find.text('候補を探してもらう'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-search')));
    await tester.pumpAndSettle();

    expect(assistant.drafts, ['重複しているタスクを消して']);
    expect(find.text('2件の候補があります'), findsOneWidget);
    expect(find.textContaining('最近更新された60件の中から選びました'), findsOneWidget);
    expect(find.text('同名のタスクが別にあるため'), findsOneWidget);
    expect(find.text('・「古いもの」がいつより前か分かりませんでした'), findsOneWidget);
    expect(box(tester, '21').value, isTrue);
    expect(box(tester, '22').value, isTrue);
  });

  testWidgets('削除 → 結果（取り消し線）→ 1件戻す → まとめて戻す', (tester) async {
    await sendTidy(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-search')));
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-delete')));
    await tester.pumpAndSettle();

    expect(assistant.deleted.single, ['11', '12', '13']);
    expect(find.text('3件を削除しました'), findsOneWidget);
    expect(find.text('削除した3件'), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-tidy-delete')), findsNothing);
    expect(find.text('3件をまとめて元に戻す'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-restore-1012')));
    await tester.pumpAndSettle();
    expect(assistant.restored, [1012]);
    expect(find.text('戻しました'), findsOneWidget);
    expect(find.text('2件をまとめて元に戻す'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-restore-all')));
    await tester.pumpAndSettle();
    expect(assistant.restored, [1012, 1011, 1013]);
    expect(find.text('元に戻しました'), findsOneWidget);
    expect(find.text('戻しました'), findsNWidgets(3));
    expect(find.byKey(const ValueKey('rapi-tidy-restore-all')), findsNothing);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-open-tasks')));
    await tester.pumpAndSettle();
    expect(find.text('タスク一覧の画面'), findsOneWidget);
  });

  testWidgets('一部失敗：削除できた分と、保護・失敗・結果不明・未送信を分けて出す', (tester) async {
    assistant.runFor = (ids) => const TaskDeleteRun(
          results: [
            TaskDeletion(taskId: '11', outcome: 'deleted', trashId: 1011),
            TaskDeletion(taskId: '12', outcome: 'protected'),
          ],
          unknown: ['13'],
        );
    await sendTidy(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-search')));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-delete')));
    await tester.pumpAndSettle();

    expect(find.text('一部を削除できませんでした'), findsOneWidget);
    expect(find.text('削除した1件'), findsOneWidget);
    expect(find.text('古い調査メモ'), findsOneWidget);
    expect(find.text('保護されているため削除しませんでした（1件）'), findsOneWidget);
    expect(find.text('・中止した企画'), findsOneWidget);
    expect(find.textContaining('削除できたか確かめられませんでした'), findsOneWidget);
    expect(find.text('・重複したバグ票'), findsOneWidget);
    // 戻せるのは1件だけなので、まとめてのボタンは出さず行の「戻す」だけ
    expect(find.byKey(const ValueKey('rapi-tidy-restore-1011')), findsOneWidget);
    expect(find.byKey(const ValueKey('rapi-tidy-restore-all')), findsNothing);
  });

  testWidgets('該当なしなら条件のまま理由を出す', (tester) async {
    assistant.filterResult = const DeleteFilterResult();
    await sendTidy(tester);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-search')));
    await tester.pumpAndSettle();

    expect(find.text('片付けるタスクを選ぶ'), findsOneWidget);
    expect(find.text('該当するタスクはありませんでした。条件をゆるめてみてください。'), findsOneWidget);
  });

  testWidgets('長い一覧は先頭20件だけ出し、「残りも表示」で全部出す', (tester) async {
    assistant.filterResult = DeleteFilterResult(
      matches: [
        for (var i = 1; i <= 25; i++) TidyItem(id: '$i', title: 'タスク$i', status: 'done'),
      ],
      total: 600,
      truncated: true,
    );
    await sendTidy(tester);
    await tester.tap(find.byKey(const ValueKey('rapi-tidy-search')));
    await tester.pumpAndSettle();

    expect(find.text('600件が該当しました'), findsOneWidget);
    expect(find.textContaining('うち25件を表示しています'), findsOneWidget);
    expect(find.text('タスク20'), findsOneWidget);
    expect(find.text('タスク21'), findsNothing);
    // 畳んで出していない分は送らない（画面に出たものだけを消す）
    expect(find.text('削除する（20件）'), findsOneWidget);
    expect(find.textContaining('表示している20件のうち'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-expand')));
    await tester.pumpAndSettle();
    expect(find.text('タスク25'), findsOneWidget);
    expect(find.text('削除する（25件）'), findsOneWidget);

    await tester.tap(find.byKey(const ValueKey('rapi-tidy-delete')));
    await tester.pumpAndSettle();
    expect(assistant.deleted.single, hasLength(25));
  });
}
