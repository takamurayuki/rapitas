import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';

void main() {
  group('TaskCategory.fromJson', () {
    test('GET /categories の行：description / mode / _count.themes を読む', () {
      final category = TaskCategory.fromJson({
        'id': 2,
        'name': '学習',
        'description': '学習に関するテーマ',
        'color': '#10B981',
        'icon': 'BookOpen',
        'mode': 'learning',
        'sortOrder': 1,
        '_count': {'themes': 4},
        'themes': [
          {'id': 10, 'name': '英語', '_count': {'tasks': 3}},
        ],
      });

      expect(category.id, '2');
      expect(category.name, '学習');
      expect(category.description, '学習に関するテーマ');
      expect(category.mode, 'learning');
      expect(category.sortOrder, 1);
      expect(category.themeCount, 4);
    });

    test('テーマに埋め込まれたカテゴリ（_count なし）は themeCount が null', () {
      final category = TaskCategory.fromJson({
        'id': 1,
        'name': '開発',
        'color': '#3B82F6',
        'mode': 'development',
        'sortOrder': 0,
      });

      expect(category.themeCount, isNull);
      expect(category.mode, 'development');
      expect(category.description, isNull);
    });

    test('_count に themes が無い・型が違う場合も null', () {
      expect(
        TaskCategory.fromJson({'id': 1, 'name': 'a', '_count': {}}).themeCount,
        isNull,
      );
      expect(
        TaskCategory.fromJson({'id': 1, 'name': 'a', '_count': 'x'}).themeCount,
        isNull,
      );
    });

    test('description / mode が null や文字列以外なら null', () {
      final category = TaskCategory.fromJson({
        'id': 1,
        'name': 'a',
        'description': null,
        'mode': 3,
      });

      expect(category.description, isNull);
      expect(category.mode, isNull);
    });

    test('GET /themes の category 経由でも読める（themeCount は null）', () {
      final theme = TaskTheme.fromJson({
        'id': 5,
        'name': 'アプリ',
        'description': 'スマホアプリ',
        'categoryId': 1,
        'category': {'id': 1, 'name': '開発', 'mode': 'development'},
        '_count': {'tasks': 2},
      });

      expect(theme.description, 'スマホアプリ');
      expect(theme.category?.mode, 'development');
      expect(theme.category?.themeCount, isNull);
    });
  });
}
