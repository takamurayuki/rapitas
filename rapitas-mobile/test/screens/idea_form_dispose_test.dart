import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/backlog/idea_form_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'default_selection_screens_test.dart' show FakeIdeaCreate, screenCategories, screenThemes;

// nav38 直し回2（G2 再レビュー必須指摘）の回帰テスト：
// アイデア作成画面をテーマ初期値の解決中に閉じても、遅れて届いた応答で
// 破棄済みの ref を読まない（例外が出ない）し、アイデアも送らない。

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  late GoRouter router;

  Widget formApp(
    FakeIdeaCreate backlog, {
    required Future<List<TaskTheme>> Function() themes,
    Future<String?> Function()? initial,
  }) {
    router = GoRouter(initialLocation: '/ideas/new', routes: [
      GoRoute(path: '/ideas', builder: (_, __) => const Scaffold(body: Text('一覧'))),
      GoRoute(path: '/ideas/new', builder: (_, __) => const IdeaFormScreen()),
    ]);
    return ProviderScope(
      overrides: [
        backlogServiceProvider.overrideWithValue(backlog),
        themeListProvider.overrideWith((ref) => themes()),
        categoryListProvider.overrideWith((ref) async => screenCategories),
        defaultCategoryIdProvider.overrideWith((ref) async => '1'),
        if (initial != null) ideaInitialSelectionProvider.overrideWith((ref) => initial()),
      ],
      child: MaterialApp.router(routerConfig: router),
    );
  }

  Future<void> closeForm(WidgetTester tester) async {
    router.go('/ideas');
    await tester.pumpAndSettle();
    expect(find.byType(IdeaFormScreen), findsNothing);
    expect(find.text('一覧'), findsOneWidget);
  }

  testWidgets('テーマ一覧の取得待ちで閉じ、その後に応答が届いても例外を出さない', (tester) async {
    final backlog = FakeIdeaCreate();
    final themes = Completer<List<TaskTheme>>();
    await tester.pumpWidget(formApp(backlog, themes: () => themes.future));
    await tester.pump();
    await closeForm(tester);

    themes.complete(screenThemes);
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(backlog.created, isEmpty);
  });

  testWidgets('初期選択（記憶・☆）の解決待ちで閉じ、その後に応答が届いても例外を出さない', (tester) async {
    final backlog = FakeIdeaCreate();
    final initial = Completer<String?>();
    await tester.pumpWidget(formApp(
      backlog,
      themes: () async => screenThemes,
      initial: () => initial.future,
    ));
    await tester.pump();
    await tester.pump();
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    await closeForm(tester);

    initial.complete('11');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(backlog.created, isEmpty);
  });

  testWidgets('「追加」を押して解決を待っている間に閉じたら、応答後もアイデアを送らない', (tester) async {
    final backlog = FakeIdeaCreate();
    final initial = Completer<String?>();
    await tester.pumpWidget(formApp(
      backlog,
      themes: () async => screenThemes,
      initial: () => initial.future,
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextFormField), '閉じる直前の案');
    await tester.tap(find.widgetWithText(FilledButton, '追加'));
    await tester.pump();
    expect(backlog.created, isEmpty);
    await closeForm(tester);

    initial.complete('11');
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
    expect(backlog.created, isEmpty);
  });

  testWidgets('閉じずに待てば、初期選択の応答どおりのテーマで送る（対照）', (tester) async {
    final backlog = FakeIdeaCreate();
    final initial = Completer<String?>();
    await tester.pumpWidget(formApp(
      backlog,
      themes: () async => screenThemes,
      initial: () => initial.future,
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextFormField), '待った案');
    await tester.tap(find.widgetWithText(FilledButton, '追加'));
    await tester.pump();

    initial.complete('21');
    await tester.pumpAndSettle();
    expect(backlog.created.single['themeId'], 21);
    expect(find.text('一覧'), findsOneWidget);
  });
}
