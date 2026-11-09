import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/widgets/app_drawer.dart';

void main() {
  group('drawerSelectedIndex', () {
    test('各画面のパスが項目の並び順のインデックスになる', () {
      expect(drawerSelectedIndex('/themes'), 0);
      expect(drawerSelectedIndex('/categories'), 1);
      expect(drawerSelectedIndex('/ideas'), 2);
      expect(drawerSelectedIndex('/concerns'), 3);
      expect(drawerSelectedIndex('/hypotheses'), 4);
      expect(drawerSelectedIndex('/dashboard'), 5);
      expect(drawerSelectedIndex('/notifications'), 6);
      expect(drawerSelectedIndex('/settings'), 7);
    });

    test('下タブの画面はドロワーに無いので -1', () {
      expect(drawerSelectedIndex('/'), -1);
      expect(drawerSelectedIndex('/tasks'), -1);
      expect(drawerSelectedIndex('/tasks/123'), -1);
      expect(drawerSelectedIndex('/tasks/new'), -1);
      expect(drawerSelectedIndex('/executions'), -1);
      expect(drawerSelectedIndex('/approvals'), -1);
    });

    test('未知のパス・一覧の配下は -1', () {
      expect(drawerSelectedIndex('/unknown'), -1);
      expect(drawerSelectedIndex(''), -1);
      expect(drawerSelectedIndex('/settings/advanced'), -1);
      expect(drawerSelectedIndex('/themes/1'), -1);
      expect(drawerSelectedIndex('/themes/new'), -1);
      expect(drawerSelectedIndex('/ideas/new'), -1);
      expect(drawerSelectedIndex('/concerns/new'), -1);
      expect(drawerSelectedIndex('/ideasx'), -1);
    });
  });
}
