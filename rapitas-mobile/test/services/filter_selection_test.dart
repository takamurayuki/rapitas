import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/services/filter_selection.dart';
import 'package:shared_preferences/shared_preferences.dart';

// タスク一覧・アイデア一覧の初期選択（記憶 → ☆ → 並び順の先頭）の解決ロジック

TaskCategory _cat(String id, int sortOrder) =>
    TaskCategory(id: id, name: 'カテゴリ$id', sortOrder: sortOrder);

TaskTheme _theme(String id, String? categoryId, {bool isDefault = false, int sortOrder = 0}) =>
    TaskTheme(
      id: id,
      name: 'テーマ$id',
      categoryId: categoryId,
      category: categoryId == null ? null : _cat(categoryId, sortOrder),
      isDefault: isDefault,
    );

void main() {
  // カテゴリ 1（sortOrder 2）: テーマ 10, 11(☆)
  // カテゴリ 2（sortOrder 1）: テーマ 20, 21
  // カテゴリなし: テーマ 90
  final themes = [
    _theme('10', '1', sortOrder: 2),
    _theme('11', '1', isDefault: true, sortOrder: 2),
    _theme('20', '2', sortOrder: 1),
    _theme('21', '2', sortOrder: 1),
    _theme('90', null),
  ];
  final categories = [_cat('1', 2), _cat('2', 1)];

  group('orderedCategoryIds', () {
    test('テーマを持つカテゴリだけを sortOrder→id の順に返す（カテゴリなしは含めない）', () {
      expect(orderedCategoryIds(themes, categories), ['2', '1']);
      // 一覧が無ければテーマに埋め込まれたカテゴリの sortOrder を使う
      expect(orderedCategoryIds(themes, null), ['2', '1']);
    });

    test('sortOrder が同じなら数値 id の小さい順', () {
      final same = [_theme('a', '12'), _theme('b', '3')];
      expect(orderedCategoryIds(same, [_cat('12', 0), _cat('3', 0)]), ['3', '12']);
    });
  });

  group('resolveTaskSelection', () {
    test('記憶（最後のカテゴリ＋そのカテゴリで最後に選んだテーマ）が最優先', () {
      final s = resolveTaskSelection(
        themes: themes,
        categories: categories,
        defaultCategoryId: '1',
        memory: const TaskSelectionMemory(lastCategoryId: '2', themeByCategory: {'2': '21'}),
      );
      expect((s!.categoryId, s.themeId), ('2', '21'));
    });

    test('記憶が無ければ ☆カテゴリ＋その ☆テーマ', () {
      final s = resolveTaskSelection(
        themes: themes,
        categories: categories,
        defaultCategoryId: '1',
        memory: const TaskSelectionMemory(),
      );
      expect((s!.categoryId, s.themeId), ('1', '11'));
    });

    test('☆カテゴリも無ければ並び順先頭のカテゴリ＋その先頭テーマ', () {
      final s = resolveTaskSelection(
        themes: themes,
        categories: categories,
        defaultCategoryId: null,
        memory: const TaskSelectionMemory(),
      );
      expect((s!.categoryId, s.themeId), ('2', '20'));
    });

    test('記憶したテーマが削除済みなら次の優先順位（☆）へ落ちる', () {
      final s = resolveTaskSelection(
        themes: themes,
        categories: categories,
        defaultCategoryId: '1',
        memory: const TaskSelectionMemory(lastCategoryId: '2', themeByCategory: {'2': '999'}),
      );
      expect((s!.categoryId, s.themeId), ('1', '11'));
    });

    test('記憶したカテゴリ・☆カテゴリが一覧に無ければ先頭へ落ちる', () {
      final s = resolveTaskSelection(
        themes: themes,
        categories: categories,
        defaultCategoryId: '77',
        memory: const TaskSelectionMemory(lastCategoryId: '88', themeByCategory: {'88': '10'}),
      );
      expect((s!.categoryId, s.themeId), ('2', '20'));
    });

    test('別カテゴリのテーマを記憶していても採用しない', () {
      final s = resolveTaskSelection(
        themes: themes,
        categories: categories,
        defaultCategoryId: null,
        memory: const TaskSelectionMemory(lastCategoryId: '2', themeByCategory: {'2': '10'}),
      );
      expect((s!.categoryId, s.themeId), ('2', '20'));
    });

    test('カテゴリに属するテーマが無ければ null（フィルターを適用しない）', () {
      expect(
        resolveTaskSelection(
          themes: [_theme('90', null)],
          categories: null,
          defaultCategoryId: null,
          memory: const TaskSelectionMemory(),
        ),
        isNull,
      );
      expect(
        resolveTaskSelection(
          themes: const [],
          categories: categories,
          defaultCategoryId: '1',
          memory: const TaskSelectionMemory(),
        ),
        isNull,
      );
    });
  });

  group('resolveThemeForCategory（カテゴリ切替時）', () {
    test('そのカテゴリでの記憶 → ☆テーマ → 先頭テーマ', () {
      const remembered = TaskSelectionMemory(themeByCategory: {'2': '21', '1': '999'});
      expect(resolveThemeForCategory(categoryId: '2', themes: themes, memory: remembered), '21');
      // 記憶が削除済みなら ☆
      expect(resolveThemeForCategory(categoryId: '1', themes: themes, memory: remembered), '11');
      // 記憶も ☆ も無ければ先頭
      expect(
        resolveThemeForCategory(categoryId: '2', themes: themes, memory: const TaskSelectionMemory()),
        '20',
      );
      expect(
        resolveThemeForCategory(categoryId: '404', themes: themes, memory: remembered),
        isNull,
      );
    });
  });

  group('resolveIdeaSelection', () {
    test('記憶したテーマが最優先。「指定なし」の記憶もそのまま使う', () {
      expect(
        resolveIdeaSelection(
            themes: themes, categories: categories, defaultCategoryId: '1', memory: '20'),
        '20',
      );
      expect(
        resolveIdeaSelection(
            themes: themes, categories: categories, defaultCategoryId: '1', memory: ideaNoThemeId),
        ideaNoThemeId,
      );
      // カテゴリなしのテーマもアイデアには選べる
      expect(
        resolveIdeaSelection(
            themes: themes, categories: categories, defaultCategoryId: '1', memory: '90'),
        '90',
      );
    });

    test('記憶が無い・削除済みなら ☆カテゴリの ☆テーマ', () {
      expect(
        resolveIdeaSelection(
            themes: themes, categories: categories, defaultCategoryId: '1', memory: '999'),
        '11',
      );
    });

    test('☆カテゴリに ☆テーマが無ければ、いずれかの ☆テーマ', () {
      expect(
        resolveIdeaSelection(
            themes: themes, categories: categories, defaultCategoryId: '2', memory: null),
        '11',
      );
    });

    test('☆テーマが1つも無ければ並び順の先頭テーマ。テーマが無ければ null', () {
      final noStar = [for (final t in themes) _theme(t.id, t.categoryId, sortOrder: t.category?.sortOrder ?? 0)];
      expect(
        resolveIdeaSelection(
            themes: noStar, categories: categories, defaultCategoryId: null, memory: null),
        '20',
      );
      expect(
        resolveIdeaSelection(
            themes: const [], categories: categories, defaultCategoryId: null, memory: null),
        isNull,
      );
    });
  });

  group('FilterSelectionStore', () {
    test('タスクはカテゴリ別に、アイデアはテーマ（または none）を文字列で記憶する', () async {
      SharedPreferences.setMockInitialValues({});
      await FilterSelectionStore.rememberTaskTheme(categoryId: '1', themeId: '11');
      await FilterSelectionStore.rememberTaskTheme(categoryId: '2', themeId: '21');
      await FilterSelectionStore.rememberIdeaTheme(ideaNoThemeId);

      final task = await FilterSelectionStore.loadTask();
      expect(task.lastCategoryId, '2');
      expect(task.themeByCategory, {'1': '11', '2': '21'});
      expect(await FilterSelectionStore.loadIdea(), 'none');
    });

    test('壊れた保存値は空の記憶として読む', () async {
      SharedPreferences.setMockInitialValues({FilterSelectionStore.themeByCategoryKey: '{oops'});
      final task = await FilterSelectionStore.loadTask();
      expect(task.lastCategoryId, isNull);
      expect(task.themeByCategory, isEmpty);
      expect(await FilterSelectionStore.loadIdea(), isNull);
    });
  });
}
