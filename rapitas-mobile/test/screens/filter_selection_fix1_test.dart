import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/backlog_provider.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/backlog/idea_form_screen.dart';
import 'package:rapitas_mobile/screens/backlog/ideas_screen.dart';
import 'package:rapitas_mobile/screens/task_list/task_list_screen.dart';
import 'package:rapitas_mobile/services/filter_selection.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'default_selection_screens_test.dart' show FakeIdeaCreate, screenCategories, screenThemes;
import 'ideas_filter_test.dart' show FakeIdeaBacklog, sampleIdeas, sampleThemes;
import 'task_filter_selection_test.dart' show FakeTaskList, sampleTaskThemes, sampleTasks;

// nav38 直し回1（G2 必須指摘1〜4）の回帰テスト：
// 1. カテゴリ切替の遅れた結果が後の選択を上書きしない
// 2. テーマ取得失敗では初期選択の権利を消費せず、再取得の成功で一度だけ選ぶ
// 3. アイデアの「クリア」で残したテーマを記憶する
// 4. アイデア作成はテーマ初期値の解決を待ってから送る

/// 記憶の読み込みを手で進められるローダー。最初の1回（一覧の初期選択）はすぐ返し、以後は保留する
class ControlledMemoryLoader {
  final List<Completer<TaskSelectionMemory>> pending = [];
  var _calls = 0;

  Future<TaskSelectionMemory> call() {
    _calls++;
    if (_calls == 1) return Future.value(const TaskSelectionMemory());
    final completer = Completer<TaskSelectionMemory>();
    pending.add(completer);
    return completer.future;
  }
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  Finder inSheet(Finder matching) =>
      find.descendant(of: find.byType(BottomSheet), matching: matching);

  group('指摘1：カテゴリ切替の非同期競合', () {
    late FakeTaskList service;
    late ControlledMemoryLoader loader;

    setUp(() {
      service = FakeTaskList(sampleTasks);
      loader = ControlledMemoryLoader();
    });

    Widget app() => ProviderScope(
          overrides: [
            taskServiceProvider.overrideWithValue(service),
            themeListProvider.overrideWith((ref) async => sampleTaskThemes),
            categoryListProvider.overrideWith((ref) async => screenCategories),
            defaultCategoryIdProvider.overrideWith((ref) async => '1'),
            taskSelectionMemoryLoaderProvider.overrideWithValue(loader.call),
          ],
          child: const MaterialApp(home: TaskListScreen()),
        );

    TaskFilter filterOf(WidgetTester tester) =>
        ProviderScope.containerOf(tester.element(find.byType(TaskListScreen))).read(taskFilterProvider);

    bool categorySelected(WidgetTester tester, String name) =>
        tester.widget<ChoiceChip>(inSheet(find.widgetWithText(ChoiceChip, name))).selected;

    Future<void> openSheet(WidgetTester tester) async {
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(filterOf(tester).themeId, '11');
      await tester.tap(find.byTooltip('フィルター'));
      await tester.pumpAndSettle();
    }

    testWidgets('読み込み中でも切り替えたカテゴリがすぐ選択表示になり、先に始めた切替の遅い結果は捨てる', (tester) async {
      await openSheet(tester);

      await tester.tap(inSheet(find.widgetWithText(ChoiceChip, '学習')));
      await tester.pump();
      expect(loader.pending, hasLength(1));
      // 記憶の読み込みを待っている間も、選んだカテゴリが選択状態に見える
      expect(categorySelected(tester, '学習'), isTrue);
      expect(categorySelected(tester, '開発'), isFalse);
      expect(inSheet(find.text('英語（3）')), findsOneWidget);

      await tester.tap(inSheet(find.widgetWithText(ChoiceChip, '開発')));
      await tester.pump();
      expect(categorySelected(tester, '開発'), isTrue);

      // 後の切替（開発）が先に終わり、その後で古い切替（学習）が届く
      loader.pending[1].complete(const TaskSelectionMemory());
      await tester.pumpAndSettle();
      loader.pending[0].complete(const TaskSelectionMemory());
      await tester.pumpAndSettle();

      expect(filterOf(tester).themeId, '11');
      expect(categorySelected(tester, '開発'), isTrue);
      final memory = await FilterSelectionStore.loadTask();
      expect(memory.lastCategoryId, '1');
      expect(memory.themeByCategory, {'1': '11'});
    });

    testWidgets('切替の読み込み中にテーマを選んだら、遅れて届いた結果でテーマも記憶も上書きしない', (tester) async {
      await openSheet(tester);

      await tester.tap(inSheet(find.widgetWithText(ChoiceChip, '学習')));
      await tester.pump();
      await tester.tap(inSheet(find.widgetWithText(FilterChip, '資格（2）')));
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);
      expect(filterOf(tester).themeId, '21');

      loader.pending.single.complete(const TaskSelectionMemory());
      await tester.pumpAndSettle();
      expect(filterOf(tester).themeId, '21');
      final memory = await FilterSelectionStore.loadTask();
      expect(memory.themeByCategory, {'2': '21'});
    });

    testWidgets('切替の読み込み中にシートを閉じたら、遅れて届いた結果を適用しない', (tester) async {
      await openSheet(tester);

      await tester.tap(inSheet(find.widgetWithText(ChoiceChip, '学習')));
      await tester.pump();
      Navigator.of(tester.element(find.byType(BottomSheet))).pop();
      await tester.pumpAndSettle();
      expect(find.byType(BottomSheet), findsNothing);

      loader.pending.single.complete(const TaskSelectionMemory());
      await tester.pumpAndSettle();
      expect(filterOf(tester).themeId, '11');
      expect((await FilterSelectionStore.loadTask()).themeByCategory, isEmpty);
    });
  });

  group('指摘2：テーマ取得失敗と正常0件の区別', () {
    testWidgets('タスク：失敗中は全件を出し続け、引っ張って更新で再取得に成功したら一度だけ ☆ を選ぶ', (tester) async {
      final service = FakeTaskList(sampleTasks);
      var themeCalls = 0;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          taskServiceProvider.overrideWithValue(service),
          themeListProvider.overrideWith((ref) async {
            themeCalls++;
            if (themeCalls == 1) throw Exception('offline');
            return sampleTaskThemes;
          }),
          categoryListProvider.overrideWith((ref) async => screenCategories),
          defaultCategoryIdProvider.overrideWith((ref) async => '1'),
        ],
        child: const MaterialApp(home: TaskListScreen()),
      ));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(TaskListScreen)));

      // 失敗しても一覧は止めない（テーマで絞らず全件）。初期選択は未完了のまま
      expect(service.themeIds, [null]);
      expect(find.text('リリース手順の整理'), findsOneWidget);
      expect(container.read(taskSelectionAppliedProvider), isFalse);

      await tester.fling(find.text('フィルターの初期選択'), const Offset(0, 400), 1000);
      await tester.pumpAndSettle();
      expect(themeCalls, 2);
      expect(container.read(taskSelectionAppliedProvider), isTrue);
      expect(container.read(taskFilterProvider).themeId, '11');
      expect(find.text('リリース手順の整理'), findsNothing);

      // 一度選んだ後は、ユーザの選択をテーマの再取得で選び直さない
      container.read(taskFilterProvider.notifier).state = const TaskFilter(themeId: '20');
      container.invalidate(themeListProvider);
      await tester.pumpAndSettle();
      expect(container.read(taskFilterProvider).themeId, '20');
    });

    testWidgets('アイデア：失敗中は全件を出し、再取得に成功したら一度だけ先頭テーマを選ぶ', (tester) async {
      final backlog = FakeIdeaBacklog(sampleIdeas);
      var themeCalls = 0;
      await tester.pumpWidget(ProviderScope(
        overrides: [
          backlogServiceProvider.overrideWithValue(backlog),
          themeListProvider.overrideWith((ref) async {
            themeCalls++;
            if (themeCalls == 1) throw Exception('offline');
            return sampleThemes;
          }),
          categoryListProvider.overrideWith((ref) async => const <TaskCategory>[]),
          defaultCategoryIdProvider.overrideWith((ref) async => null),
        ],
        child: const MaterialApp(home: IdeasScreen()),
      ));
      await tester.pumpAndSettle();
      final container = ProviderScope.containerOf(tester.element(find.byType(IdeasScreen)));

      expect(backlog.calls.single['themeId'], isNull);
      expect(find.byType(ListTile), findsNWidgets(3));
      expect(container.read(ideaSelectionAppliedProvider), isFalse);

      await tester.fling(find.byType(ListTile).first, const Offset(0, 400), 1000);
      await tester.pumpAndSettle();
      expect(themeCalls, 2);
      expect(container.read(ideaFilterProvider).themeId, '10');
      expect(backlog.calls.last['themeId'], '10');

      container.read(ideaFilterProvider.notifier).state = const IdeaFilter(themeId: ideaNoThemeId);
      container.invalidate(themeListProvider);
      await tester.pumpAndSettle();
      expect(container.read(ideaFilterProvider).themeId, ideaNoThemeId);
    });

    test('正常な0件は「絞らない」で確定し、取得失敗はエラーのまま（適用済みにしない）', () async {
      final empty = ProviderContainer(overrides: [
        themeListProvider.overrideWith((ref) async => const <TaskTheme>[]),
      ]);
      addTearDown(empty.dispose);
      expect(await empty.read(taskInitialSelectionProvider.future), isNull);
      applyInitialTaskSelection(empty.read, empty.read(taskInitialSelectionProvider));
      expect(empty.read(taskSelectionAppliedProvider), isTrue);
      expect(empty.read(taskSelectionPendingProvider), isFalse);

      final failed = ProviderContainer(overrides: [
        themeListProvider.overrideWith((ref) async => throw Exception('offline')),
      ]);
      addTearDown(failed.dispose);
      await expectLater(failed.read(ideaInitialSelectionProvider.future), throwsException);
      applyInitialIdeaSelection(failed.read, failed.read(ideaInitialSelectionProvider));
      expect(failed.read(ideaSelectionAppliedProvider), isFalse);
      // 失敗中も一覧は待たせない
      expect(failed.read(ideaSelectionPendingProvider), isFalse);
    });
  });

  group('指摘3：アイデアの「クリア」で残したテーマの記憶', () {
    testWidgets('シートでテーマを変えて「クリア」すると、そのテーマを適用・記憶し、開き直しても同じテーマになる', (tester) async {
      SharedPreferences.setMockInitialValues({FilterSelectionStore.ideaThemeKey: '10'});
      final backlog = FakeIdeaBacklog(sampleIdeas);
      Widget app() => ProviderScope(
            overrides: [
              backlogServiceProvider.overrideWithValue(backlog),
              themeListProvider.overrideWith((ref) async => sampleThemes),
              categoryListProvider.overrideWith((ref) async => const <TaskCategory>[]),
              defaultCategoryIdProvider.overrideWith((ref) async => null),
            ],
            child: const MaterialApp(home: IdeasScreen()),
          );
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(backlog.calls.first['themeId'], '10');

      await tester.tap(find.byTooltip('フィルター'));
      await tester.pumpAndSettle();
      await tester.tap(inSheet(find.widgetWithText(FilterChip, '使用済み')));
      await tester.tap(inSheet(find.widgetWithText(FilterChip, 'デスクトップ')));
      await tester.pump();
      final clear = find.widgetWithText(TextButton, 'クリア');
      await tester.ensureVisible(clear);
      await tester.tap(clear);
      await tester.pumpAndSettle();

      final container = ProviderScope.containerOf(tester.element(find.byType(IdeasScreen)));
      expect(container.read(ideaFilterProvider), const IdeaFilter(themeId: '11'));
      final prefs = await SharedPreferences.getInstance();
      expect(prefs.getString(FilterSelectionStore.ideaThemeKey), '11');

      // アプリの再起動に相当：ProviderScope を作り直すと記憶から B（デスクトップ）で始まる
      await tester.pumpWidget(const SizedBox());
      backlog.calls.clear();
      await tester.pumpWidget(app());
      await tester.pumpAndSettle();
      expect(backlog.calls.first['themeId'], '11');
      expect(find.widgetWithText(InputChip, 'テーマ：デスクトップ'), findsOneWidget);
    });
  });

  group('指摘4：アイデア作成のテーマ初期値の解決待ち', () {
    Widget formApp(FakeIdeaCreate backlog, Future<List<TaskTheme>> Function() themes) {
      final router = GoRouter(initialLocation: '/ideas/new', routes: [
        GoRoute(path: '/ideas', builder: (_, __) => const Scaffold(body: Text('一覧'))),
        GoRoute(path: '/ideas/new', builder: (_, __) => const IdeaFormScreen()),
      ]);
      return ProviderScope(
        overrides: [
          backlogServiceProvider.overrideWithValue(backlog),
          themeListProvider.overrideWith((ref) => themes()),
          categoryListProvider.overrideWith((ref) async => screenCategories),
          defaultCategoryIdProvider.overrideWith((ref) async => '1'),
        ],
        child: MaterialApp.router(routerConfig: router),
      );
    }

    Future<void> enterTitleAndSave(WidgetTester tester, String title) async {
      await tester.enterText(find.byType(TextFormField), title);
      await tester.tap(find.widgetWithText(FilledButton, '追加'));
      await tester.pump();
    }

    testWidgets('テーマ一覧の応答が遅いうちに「追加」を押しても、解決を待って ☆ テーマで送る', (tester) async {
      final backlog = FakeIdeaCreate();
      final themes = Completer<List<TaskTheme>>();
      await tester.pumpWidget(formApp(backlog, () => themes.future));
      await tester.pump();
      expect(find.byType(LinearProgressIndicator), findsOneWidget);

      await enterTitleAndSave(tester, '急いで書いた案');
      await tester.pump(const Duration(milliseconds: 100));
      // 解決前には送らない（以前はここでテーマなし・scope: global で作られていた）
      expect(backlog.created, isEmpty);
      final button = tester.widget<FilledButton>(find.byType(FilledButton));
      expect(button.onPressed, isNull);

      themes.complete(screenThemes);
      await tester.pumpAndSettle();
      expect(backlog.created.single['themeId'], 11);
      expect(backlog.created.single['scope'], 'project');
      expect(find.text('一覧'), findsOneWidget);
    });

    testWidgets('記憶の「指定なし」も解決を待ってから、themeId なしで送る', (tester) async {
      SharedPreferences.setMockInitialValues({FilterSelectionStore.ideaThemeKey: ideaNoThemeId});
      final backlog = FakeIdeaCreate();
      final themes = Completer<List<TaskTheme>>();
      await tester.pumpWidget(formApp(backlog, () => themes.future));
      await tester.pump();
      await enterTitleAndSave(tester, '未定の案');
      expect(backlog.created, isEmpty);

      themes.complete(screenThemes);
      await tester.pumpAndSettle();
      expect(backlog.created.single.containsKey('themeId'), isFalse);
      expect(backlog.created.single['scope'], 'global');
    });

    testWidgets('テーマ一覧の取得に失敗したら、その旨を出して「指定なし」で作る', (tester) async {
      final backlog = FakeIdeaCreate();
      await tester.pumpWidget(formApp(backlog, () async => throw Exception('offline')));
      await tester.pumpAndSettle();
      expect(find.text('テーマ一覧を取得できないため、テーマは「指定なし」で追加します'), findsOneWidget);

      await enterTitleAndSave(tester, 'オフラインの案');
      await tester.pumpAndSettle();
      expect(backlog.created.single.containsKey('themeId'), isFalse);
      expect(backlog.created.single['scope'], 'global');
    });

    testWidgets('テーマが0件ならテーマ欄を出さず「指定なし」で作る', (tester) async {
      final backlog = FakeIdeaCreate();
      await tester.pumpWidget(formApp(backlog, () async => const <TaskTheme>[]));
      await tester.pumpAndSettle();
      expect(find.widgetWithText(InputDecorator, 'テーマ'), findsNothing);
      expect(find.byType(LinearProgressIndicator), findsNothing);

      await enterTitleAndSave(tester, 'テーマなしの案');
      await tester.pumpAndSettle();
      expect(backlog.created.single.containsKey('themeId'), isFalse);
    });
  });
}
