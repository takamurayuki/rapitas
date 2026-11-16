import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/reorder_orders.dart';

void main() {
  group('buildReorderOrders', () {
    test('表示順どおりに id と sortOrder 0,1,2… の組を作り、id は int にする', () {
      final orders = buildReorderOrders(['12', '3', '7']);

      expect(orders, [
        {'id': 12, 'sortOrder': 0},
        {'id': 3, 'sortOrder': 1},
        {'id': 7, 'sortOrder': 2},
      ]);
      expect(orders.every((o) => o['id'] is int && o['sortOrder'] is int), isTrue);
    });

    test('空リストなら空リスト', () {
      expect(buildReorderOrders(const []), isEmpty);
    });

    test('整数でない id は黙って送らず FormatException', () {
      expect(() => buildReorderOrders(['1', 'abc']), throwsFormatException);
    });
  });

  group('splitReorderOrders', () {
    test('上限ごとに分け、sortOrder は通しの値のまま', () {
      final orders = buildReorderOrders([for (var i = 1; i <= 5; i++) '$i']);

      final batches = splitReorderOrders(orders, limit: 2);

      expect(batches.length, 3);
      expect(batches.map((b) => b.length).toList(), [2, 2, 1]);
      expect(batches.last.single, {'id': 5, 'sortOrder': 4});
    });

    test('上限以下なら1回、空なら0回', () {
      expect(splitReorderOrders(buildReorderOrders(['1', '2'])).length, 1);
      expect(splitReorderOrders(const []), isEmpty);
    });
  });

  group('moveItem', () {
    test('下へ移すときは onReorder の newIndex を補正する', () {
      // a を c の後ろへ（ReorderableListView では newIndex = 3）
      expect(moveItem(['a', 'b', 'c'], 0, 3), ['b', 'c', 'a']);
      expect(moveItem(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
      expect(moveItem(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
    });

    test('元のリストは変更しない', () {
      final items = ['a', 'b'];
      moveItem(items, 0, 2);
      expect(items, ['a', 'b']);
    });

    test('groupOf を渡すと同じグループの範囲内だけ動かせる', () {
      // (グループ, 名前)
      final items = [('x', 'a'), ('x', 'b'), ('y', 'c'), ('y', 'd')];
      String groupOf((String, String) item) => item.$1;

      // グループ内の移動は可（a を b の後ろへ）
      expect(moveItem(items, 0, 2, groupOf: groupOf),
          [('x', 'b'), ('x', 'a'), ('y', 'c'), ('y', 'd')]);
      // d を c の前へ
      expect(moveItem(items, 3, 2, groupOf: groupOf),
          [('x', 'a'), ('x', 'b'), ('y', 'd'), ('y', 'c')]);
      // グループをまたぐ移動は不可（a を c の後ろへ／d を先頭へ）
      expect(moveItem(items, 0, 3, groupOf: groupOf), isNull);
      expect(moveItem(items, 3, 0, groupOf: groupOf), isNull);
    });

    test('グループに1件しかなければ元の位置以外へは動かせない', () {
      final items = [('x', 'a'), ('y', 'b'), ('z', 'c')];
      String groupOf((String, String) item) => item.$1;

      expect(moveItem(items, 1, 0, groupOf: groupOf), isNull);
      expect(moveItem(items, 1, 3, groupOf: groupOf), isNull);
      expect(moveItem(items, 1, 1, groupOf: groupOf), items);
    });

    test('null もグループとして扱う（未分類同士は入れ替え可）', () {
      final items = [('x', 'a'), (null, 'b'), (null, 'c')];
      String? groupOf((String?, String) item) => item.$1;

      expect(moveItem(items, 2, 1, groupOf: groupOf),
          [('x', 'a'), (null, 'c'), (null, 'b')]);
      expect(moveItem(items, 2, 0, groupOf: groupOf), isNull);
    });
  });
}
