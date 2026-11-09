import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/widgets/app_drawer.dart';

void main() {
  group('drawerSelectedIndex', () {
    test('各画面のパスが項目の並び順のインデックスになる', () {
      expect(drawerSelectedIndex('/'), 0);
      expect(drawerSelectedIndex('/tasks'), 1);
      expect(drawerSelectedIndex('/themes'), 2);
      expect(drawerSelectedIndex('/dashboard'), 3);
      expect(drawerSelectedIndex('/executions'), 4);
      expect(drawerSelectedIndex('/approvals'), 5);
      expect(drawerSelectedIndex('/notifications'), 6);
      expect(drawerSelectedIndex('/settings'), 7);
    });

    test('タスク配下（詳細・作成・編集）はタスク項目', () {
      expect(drawerSelectedIndex('/tasks/123'), 1);
      expect(drawerSelectedIndex('/tasks/new'), 1);
      expect(drawerSelectedIndex('/tasks/123/edit'), 1);
    });

    test('未知のパスは -1', () {
      expect(drawerSelectedIndex('/unknown'), -1);
      expect(drawerSelectedIndex(''), -1);
      expect(drawerSelectedIndex('/tasksx'), -1);
      expect(drawerSelectedIndex('/settings/advanced'), -1);
      expect(drawerSelectedIndex('/themes/1'), -1);
    });
  });
}
