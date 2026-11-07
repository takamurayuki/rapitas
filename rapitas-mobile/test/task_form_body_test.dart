import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/screens/task_form/task_form_screen.dart';

void main() {
  group('buildTaskFormBody', () {
    test('作成時は空の任意項目をキーごと省き、null を含めない', () {
      final body = buildTaskFormBody(
        title: '  買い物  ',
        description: '   ',
        priority: 'medium',
      );

      expect(body, {'title': '買い物', 'priority': 'medium'});
      expect(body.containsKey('description'), isFalse);
      expect(body.containsKey('dueDate'), isFalse);
      expect(body.containsKey('themeId'), isFalse);
      expect(body.values.contains(null), isFalse);
    });

    test('説明が null でもキーを省く', () {
      final body = buildTaskFormBody(
        title: 'タスク',
        description: null,
        priority: 'low',
        themeId: null,
      );

      expect(body.containsKey('description'), isFalse);
      expect(body.containsKey('themeId'), isFalse);
      expect(body.values.contains(null), isFalse);
    });

    test('数値文字列の themeId は int にして送る', () {
      final body = buildTaskFormBody(
        title: 'タスク',
        priority: 'high',
        themeId: '12',
      );

      expect(body['themeId'], 12);
      expect(body['themeId'], isA<int>());
    });

    test('int に変換できない themeId は送らない', () {
      final body = buildTaskFormBody(
        title: 'タスク',
        priority: 'high',
        themeId: 'abc',
      );

      expect(body.containsKey('themeId'), isFalse);
      expect(body.values.contains(null), isFalse);
    });

    test('期限は日付のみの ISO8601 文字列にする', () {
      final body = buildTaskFormBody(
        title: 'タスク',
        priority: 'urgent',
        dueDate: DateTime(2026, 3, 5, 18, 30),
      );

      expect(body['dueDate'], '2026-03-05');
    });

    test('値がそろっていればすべて送る', () {
      final body = buildTaskFormBody(
        title: 'タスク',
        description: '説明',
        priority: 'high',
        dueDate: DateTime(2026, 11, 7),
        themeId: '3',
      );

      expect(body, {
        'title': 'タスク',
        'description': '説明',
        'priority': 'high',
        'dueDate': '2026-11-07',
        'themeId': 3,
      });
    });

    test('編集時に説明を空にしたら null ではなく空文字を送る', () {
      final body = buildTaskFormBody(
        title: 'タスク',
        description: '',
        priority: 'medium',
        isEdit: true,
      );

      expect(body['description'], '');
      expect(body.values.contains(null), isFalse);
    });
  });
}
