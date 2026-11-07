import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';

TaskTheme _theme(
  String id, {
  String? categoryId,
  TaskCategory? category,
}) =>
    TaskTheme(id: id, name: 'theme$id', categoryId: categoryId, category: category);

TaskCategory _category(String id, String name) => TaskCategory(id: id, name: name);

void main() {
  group('TaskTheme.fromJson', () {
    test('category / categoryId / _count を読み取る', () {
      final theme = TaskTheme.fromJson({
        'id': 3,
        'name': '英語',
        'color': '#FF0000',
        'categoryId': 7,
        'category': {
          'id': 7,
          'name': '学習',
          'color': '#00FF00',
          'icon': 'book',
          'sortOrder': 2,
        },
        '_count': {'tasks': 5},
      });

      expect(theme.id, '3');
      expect(theme.name, '英語');
      expect(theme.color, '#FF0000');
      expect(theme.categoryId, '7');
      expect(theme.taskCount, 5);
      final category = theme.category!;
      expect(category.id, '7');
      expect(category.name, '学習');
      expect(category.color, '#00FF00');
      expect(category.icon, 'book');
      expect(category.sortOrder, 2);
    });

    test('category / categoryId / _count が無ければ null', () {
      final theme = TaskTheme.fromJson({'id': '1', 'name': '仕事'});

      expect(theme.id, '1');
      expect(theme.color, isNull);
      expect(theme.categoryId, isNull);
      expect(theme.category, isNull);
      expect(theme.taskCount, isNull);
    });

    test('category が Map でない・_count.tasks が数値でない場合は捨てる', () {
      final theme = TaskTheme.fromJson({
        'id': 1,
        'name': '仕事',
        'categoryId': 2,
        'category': 'invalid',
        '_count': {'tasks': 'many'},
      });

      expect(theme.categoryId, '2');
      expect(theme.category, isNull);
      expect(theme.taskCount, isNull);
    });

    test('toJson は従来のキーだけ', () {
      final theme = TaskTheme.fromJson({
        'id': 3,
        'name': '英語',
        'color': '#FF0000',
        'categoryId': 7,
        '_count': {'tasks': 5},
      });

      expect(theme.toJson(), {'id': 3, 'name': '英語', 'color': '#FF0000'});
    });
  });

  group('groupThemesByCategory', () {
    test('空リストは空', () {
      expect(groupThemesByCategory([]), isEmpty);
    });

    test('カテゴリはテーマ一覧に最初に現れた順、テーマの順も保つ', () {
      final work = _category('10', '仕事');
      final study = _category('20', '学習');
      final groups = groupThemesByCategory([
        _theme('1', categoryId: '20', category: study),
        _theme('2', categoryId: '10', category: work),
        _theme('3', categoryId: '20', category: study),
      ]);

      expect(groups.map((g) => g.categoryId), ['20', '10']);
      expect(groups[0].category?.name, '学習');
      expect(groups[0].themes.map((t) => t.id), ['1', '3']);
      expect(groups[1].category?.name, '仕事');
      expect(groups[1].themes.map((t) => t.id), ['2']);
    });

    test('categoryId が null のテーマは最後の「その他」グループ', () {
      final work = _category('10', '仕事');
      final groups = groupThemesByCategory([
        _theme('1'),
        _theme('2', categoryId: '10', category: work),
        _theme('3'),
      ]);

      expect(groups.length, 2);
      expect(groups[0].categoryId, '10');
      expect(groups.last.isUncategorized, isTrue);
      expect(groups.last.category, isNull);
      expect(groups.last.themes.map((t) => t.id), ['1', '3']);
    });

    test('categoryId が null なら category オブジェクトがあっても「その他」グループ', () {
      final work = _category('10', '仕事');
      final groups = groupThemesByCategory([
        _theme('1', category: work),
        _theme('2', categoryId: '10', category: work),
      ]);

      expect(groups.map((g) => g.categoryId), ['10', null]);
      expect(groups[0].themes.map((t) => t.id), ['2']);
      expect(groups.last.isUncategorized, isTrue);
      expect(groups.last.category, isNull);
      expect(groups.last.themes.map((t) => t.id), ['1']);
    });

    test('category が無い（categoryId のみ）テーマは categoryId 単位で分け、その他に混ぜない', () {
      final groups = groupThemesByCategory([
        _theme('1', categoryId: '30'),
        _theme('2'),
        _theme('3', categoryId: '40'),
        _theme('4', categoryId: '30'),
      ]);

      expect(groups.map((g) => g.categoryId), ['30', '40', null]);
      expect(groups[0].category, isNull);
      expect(groups[0].isUncategorized, isFalse);
      expect(groups[0].themes.map((t) => t.id), ['1', '4']);
      expect(groups[2].themes.map((t) => t.id), ['2']);
    });

    test('同じ categoryId の他テーマにカテゴリ情報があればそれを使う', () {
      final work = _category('10', '仕事');
      final groups = groupThemesByCategory([
        _theme('1', categoryId: '10'),
        _theme('2', categoryId: '10', category: work),
      ]);

      expect(groups.length, 1);
      expect(groups[0].category?.name, '仕事');
      expect(groups[0].themes.map((t) => t.id), ['1', '2']);
    });

    test('その他グループが無ければ付けない', () {
      final groups = groupThemesByCategory([
        _theme('1', categoryId: '10', category: _category('10', '仕事')),
      ]);

      expect(groups.length, 1);
      expect(groups.any((g) => g.isUncategorized), isFalse);
    });
  });
}
