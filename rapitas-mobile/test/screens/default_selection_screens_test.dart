import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/backlog_provider.dart';
import 'package:rapitas_mobile/providers/filter_selection_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/screens/backlog/idea_form_screen.dart';
import 'package:rapitas_mobile/screens/categories/categories_screen.dart';
import 'package:rapitas_mobile/screens/themes/themes_screen.dart';
import 'package:rapitas_mobile/services/backlog_service.dart';
import 'package:rapitas_mobile/services/category_service.dart';
import 'package:rapitas_mobile/services/filter_selection.dart';
import 'package:rapitas_mobile/services/theme_service.dart';
import 'package:shared_preferences/shared_preferences.dart';

// アイデア作成フォームのテーマ欄と、テーマ・カテゴリ管理画面の ☆ トグル

final _dev = TaskCategory(id: '1', name: '開発', color: '#3B82F6', sortOrder: 1);
final _study = TaskCategory(id: '2', name: '学習', color: '#10B981', sortOrder: 2);

/// 表示確認・画面テストで共用するダミーデータ
final screenThemes = [
  TaskTheme(id: '10', name: 'rapitas', color: '#6366F1', categoryId: '1', category: _dev, taskCount: 12),
  TaskTheme(
      id: '11', name: 'スマホアプリ', color: '#F59E0B', categoryId: '1', category: _dev, taskCount: 5, isDefault: true),
  TaskTheme(id: '20', name: '英語', color: '#EF4444', categoryId: '2', category: _study, taskCount: 3, isDefault: true),
  TaskTheme(id: '21', name: '資格', color: '#8B5CF6', categoryId: '2', category: _study, taskCount: 2),
];

final screenCategories = [
  TaskCategory(id: '1', name: '開発', color: '#3B82F6', sortOrder: 1, themeCount: 2, mode: 'development'),
  TaskCategory(id: '2', name: '学習', color: '#10B981', sortOrder: 2, themeCount: 2, mode: 'learning'),
];

class FakeIdeaCreate implements BacklogService {
  final List<Map<String, dynamic>> created = [];

  @override
  Future<void> createIdea(Map<String, dynamic> data) async => created.add(data);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeThemeStar implements ThemeService {
  final List<String> starred = [];

  @override
  Future<List<TaskTheme>> getThemes() async => screenThemes;

  @override
  Future<void> setDefaultTheme(String id) async => starred.add(id);

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class FakeCategoryStar implements CategoryService {
  final List<String> starred = [];
  String? defaultId;

  FakeCategoryStar(this.defaultId);

  @override
  Future<List<TaskCategory>> getCategories() async => screenCategories;

  @override
  Future<String?> getDefaultCategoryId() async => defaultId;

  @override
  Future<void> setDefaultCategory(String id) async {
    starred.add(id);
    defaultId = id;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// アイデア作成フォーム（保存後の遷移先 /ideas も用意する）
Widget buildIdeaFormApp(FakeIdeaCreate backlog, {String? defaultCategoryId = '1'}) {
  final router = GoRouter(initialLocation: '/ideas/new', routes: [
    GoRoute(path: '/ideas', builder: (_, __) => const Scaffold(body: Text('一覧'))),
    GoRoute(path: '/ideas/new', builder: (_, __) => const IdeaFormScreen()),
  ]);
  return ProviderScope(
    overrides: [
      backlogServiceProvider.overrideWithValue(backlog),
      themeListProvider.overrideWith((ref) async => screenThemes),
      categoryListProvider.overrideWith((ref) async => screenCategories),
      defaultCategoryIdProvider.overrideWith((ref) async => defaultCategoryId),
    ],
    child: MaterialApp.router(routerConfig: router),
  );
}

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  String dropdownValue(WidgetTester tester) =>
      tester.widget<DropdownButton<String>>(find.byWidgetPredicate(
          (w) => w is DropdownButton<String> && w.items!.any((i) => i.value == ideaNoThemeId))).value!;

  group('アイデア作成フォームのテーマ欄', () {
    testWidgets('テーマ欄があり、初期値は ☆カテゴリの ☆テーマ。選んだテーマを数値で送る', (tester) async {
      final backlog = FakeIdeaCreate();
      await tester.pumpWidget(buildIdeaFormApp(backlog));
      await tester.pumpAndSettle();

      expect(find.widgetWithText(InputDecorator, 'テーマ'), findsOneWidget);
      expect(dropdownValue(tester), '11');

      await tester.enterText(find.byType(TextFormField), '通知をまとめる');
      await tester.tap(find.widgetWithText(FilledButton, '追加'));
      await tester.pumpAndSettle();
      expect(backlog.created.single['themeId'], 11);
      expect(backlog.created.single['scope'], 'project');
    });

    testWidgets('「指定なし」を記憶していれば指定なしで始まり、themeId を送らない', (tester) async {
      SharedPreferences.setMockInitialValues({FilterSelectionStore.ideaThemeKey: ideaNoThemeId});
      final backlog = FakeIdeaCreate();
      await tester.pumpWidget(buildIdeaFormApp(backlog));
      await tester.pumpAndSettle();
      expect(dropdownValue(tester), ideaNoThemeId);
      expect(find.text('指定なし'), findsOneWidget);

      await tester.enterText(find.byType(TextFormField), '未定の案');
      await tester.tap(find.widgetWithText(FilledButton, '追加'));
      await tester.pumpAndSettle();
      expect(backlog.created.single.containsKey('themeId'), isFalse);
      expect(backlog.created.single['scope'], 'global');
    });

    testWidgets('一覧で選んでいるテーマがあればそれを初期値にする', (tester) async {
      final backlog = FakeIdeaCreate();
      await tester.pumpWidget(buildIdeaFormApp(backlog));
      final container = ProviderScope.containerOf(tester.element(find.byType(MaterialApp)));
      container.read(ideaFilterProvider.notifier).state = const IdeaFilter(themeId: '21');
      await tester.pumpAndSettle();
      expect(dropdownValue(tester), '21');
    });
  });

  group('☆ トグル', () {
    testWidgets('テーマ画面：☆テーマは塗りつぶし、他は輪郭。輪郭を押すと set-default して取り直す', (tester) async {
      final themes = FakeThemeStar();
      await tester.pumpWidget(ProviderScope(
        overrides: [themeServiceProvider.overrideWithValue(themes)],
        child: const MaterialApp(home: ThemesScreen()),
      ));
      await tester.pumpAndSettle();

      expect(find.byIcon(Icons.star), findsNWidgets(2));
      expect(find.byIcon(Icons.star_border), findsNWidgets(2));
      await tester.tap(find.descendant(
          of: find.widgetWithText(ListTile, '資格'), matching: find.byIcon(Icons.star_border)));
      await tester.pumpAndSettle();
      expect(themes.starred, ['21']);
    });

    testWidgets('カテゴリ画面：☆ は defaultCategoryId のカテゴリ。押すと set-default して切り替わる', (tester) async {
      final categories = FakeCategoryStar('1');
      await tester.pumpWidget(ProviderScope(
        overrides: [categoryServiceProvider.overrideWithValue(categories)],
        child: const MaterialApp(home: CategoriesScreen()),
      ));
      await tester.pumpAndSettle();

      Finder starOf(String name, IconData icon) =>
          find.descendant(of: find.widgetWithText(ListTile, name), matching: find.byIcon(icon));
      expect(starOf('開発', Icons.star), findsOneWidget);
      expect(starOf('学習', Icons.star_border), findsOneWidget);

      await tester.tap(starOf('学習', Icons.star_border));
      await tester.pumpAndSettle();
      expect(categories.starred, ['2']);
      expect(starOf('学習', Icons.star), findsOneWidget);
      expect(starOf('開発', Icons.star_border), findsOneWidget);
    });
  });
}
