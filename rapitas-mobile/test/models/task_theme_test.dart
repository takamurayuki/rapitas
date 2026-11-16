import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';

TaskTheme _theme(
  String id, {
  String? categoryId,
  TaskCategory? category,
}) =>
    TaskTheme(id: id, name: 'theme$id', categoryId: categoryId, category: category);

TaskCategory _category(String id, String name, {int? sortOrder}) =>
    TaskCategory(id: id, name: name, sortOrder: sortOrder);

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

    test('isDevelopment / workingDirectory を読み取る', () {
      final theme = TaskTheme.fromJson({
        'id': 3,
        'name': 'rapitas',
        'isDevelopment': true,
        'workingDirectory': '/home/user/rapitas',
      });

      expect(theme.isDevelopment, isTrue);
      expect(theme.workingDirectory, '/home/user/rapitas');
    });

    test('isDevelopment / workingDirectory が無ければ false / null', () {
      final theme = TaskTheme.fromJson({'id': 1, 'name': '仕事'});

      expect(theme.isDevelopment, isFalse);
      expect(theme.workingDirectory, isNull);
    });

    test('workingDirectory が null なら null・空文字はそのまま保持', () {
      final nullDir = TaskTheme.fromJson({
        'id': 1,
        'name': '仕事',
        'isDevelopment': false,
        'workingDirectory': null,
      });
      final emptyDir = TaskTheme.fromJson({
        'id': 2,
        'name': '開発',
        'isDevelopment': true,
        'workingDirectory': '',
      });

      expect(nullDir.isDevelopment, isFalse);
      expect(nullDir.workingDirectory, isNull);
      expect(emptyDir.workingDirectory, '');
    });
  });

  group('Task.canExecuteWithAgent', () {
    Task task({TaskTheme? theme, bool agentExecutable = false, bool isDeveloperMode = false}) =>
        Task(
          id: '1',
          title: 'task',
          createdAt: DateTime.utc(2026, 11, 1),
          updatedAt: DateTime.utc(2026, 11, 1),
          theme: theme,
          agentExecutable: agentExecutable,
          isDeveloperMode: isDeveloperMode,
        );

    TaskTheme theme({bool isDevelopment = false, String? workingDirectory}) => TaskTheme(
          id: '3',
          name: 'rapitas',
          isDevelopment: isDevelopment,
          workingDirectory: workingDirectory,
        );

    test('開発指定＋作業フォルダあり → true', () {
      expect(
        task(theme: theme(isDevelopment: true, workingDirectory: '/repo')).canExecuteWithAgent,
        isTrue,
      );
    });

    test('開発指定のみ（作業フォルダなし）→ false', () {
      expect(task(theme: theme(isDevelopment: true)).canExecuteWithAgent, isFalse);
    });

    test('開発指定＋作業フォルダが空文字 → false', () {
      expect(
        task(theme: theme(isDevelopment: true, workingDirectory: '')).canExecuteWithAgent,
        isFalse,
      );
    });

    test('作業フォルダのみ（開発指定なし）→ false', () {
      expect(task(theme: theme(workingDirectory: '/repo')).canExecuteWithAgent, isFalse);
    });

    test('テーマなし → false（タスク側フラグが立っていても）', () {
      expect(
        task(agentExecutable: true, isDeveloperMode: true).canExecuteWithAgent,
        isFalse,
      );
    });

    test('GET /tasks の行（theme に全列）から判定できる', () {
      final parsed = Task.fromJson({
        'id': 545,
        'title': 'モバイル版の実行ボタン',
        'agentExecutable': false,
        'isDeveloperMode': false,
        'createdAt': '2026-11-01T09:00:00.000Z',
        'updatedAt': '2026-11-07T09:00:00.000Z',
        'themeId': 3,
        'theme': {
          'id': 3,
          'name': 'rapitas',
          'color': '#3366FF',
          'isDevelopment': true,
          'workingDirectory': '/home/user/rapitas',
          'repositoryUrl': null,
          'defaultBranch': 'develop',
          'categoryId': null,
        },
      });

      expect(parsed.canExecuteWithAgent, isTrue);
    });
  });

  group('groupThemesByCategory', () {
    test('空リストは空', () {
      expect(groupThemesByCategory([]), isEmpty);
    });

    test('sortOrder が全て無い場合はテーマ一覧に最初に現れた順、テーマの順も保つ', () {
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

    test('カテゴリの sortOrder 昇順に並べ、グループ内のテーマ順は入力順を保つ', () {
      final work = _category('10', '仕事', sortOrder: 2);
      final study = _category('20', '学習', sortOrder: 0);
      final hobby = _category('30', '趣味', sortOrder: 1);
      final groups = groupThemesByCategory([
        _theme('1', categoryId: '10', category: work),
        _theme('2', categoryId: '20', category: study),
        _theme('3', categoryId: '30', category: hobby),
        _theme('4', categoryId: '10', category: work),
        _theme('5', categoryId: '20', category: study),
      ]);

      expect(groups.map((g) => g.categoryId), ['20', '30', '10']);
      expect(groups[0].themes.map((t) => t.id), ['2', '5']);
      expect(groups[1].themes.map((t) => t.id), ['3']);
      expect(groups[2].themes.map((t) => t.id), ['1', '4']);
    });

    test('sortOrder が同値なら最初に現れた順（安定）', () {
      final a = _category('10', 'A', sortOrder: 1);
      final b = _category('20', 'B', sortOrder: 1);
      final c = _category('30', 'C', sortOrder: 1);
      final d = _category('40', 'D', sortOrder: 0);
      final groups = groupThemesByCategory([
        _theme('1', categoryId: '30', category: c),
        _theme('2', categoryId: '10', category: a),
        _theme('3', categoryId: '40', category: d),
        _theme('4', categoryId: '20', category: b),
      ]);

      expect(groups.map((g) => g.categoryId), ['40', '30', '10', '20']);
    });

    test('sortOrder が無いグループは sortOrder ありの後ろ（最初に現れた順）、その他は最後', () {
      final work = _category('10', '仕事', sortOrder: 5);
      final study = _category('20', '学習', sortOrder: 1);
      final groups = groupThemesByCategory([
        _theme('1'),
        _theme('2', categoryId: '50'),
        _theme('3', categoryId: '10', category: work),
        _theme('4', categoryId: '40'),
        _theme('5', categoryId: '20', category: study),
      ]);

      expect(groups.map((g) => g.categoryId), ['20', '10', '50', '40', null]);
      expect(groups.last.isUncategorized, isTrue);
      expect(groups.last.themes.map((t) => t.id), ['1']);
    });

    test('その他のテーマが先頭に現れても、その他グループは最後', () {
      final study = _category('20', '学習', sortOrder: 0);
      final groups = groupThemesByCategory([
        _theme('1'),
        _theme('2'),
        _theme('3', categoryId: '20', category: study),
      ]);

      expect(groups.map((g) => g.categoryId), ['20', null]);
      expect(groups.last.themes.map((t) => t.id), ['1', '2']);
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
