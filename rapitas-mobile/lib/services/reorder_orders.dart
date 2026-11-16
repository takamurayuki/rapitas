/// 並び替え API（PATCH /themes/reorder・PATCH /categories/reorder）の
/// `orders` を組み立てる。
///
/// 表示順に sortOrder を 0, 1, 2… と振る。バックエンドの id は Int なので
/// int にして送る。
///
/// @param orderedIds - 並び替え後の表示順どおりの id 一覧
/// @returns `[{id: int, sortOrder: int}, ...]`。空リストなら空リスト
/// @throws FormatException id が整数に変換できない場合（不正な id を黙って送らない）
List<Map<String, int>> buildReorderOrders(List<String> orderedIds) {
  return [
    for (var i = 0; i < orderedIds.length; i++)
      {'id': int.parse(orderedIds[i].trim()), 'sortOrder': i},
  ];
}

/// PATCH /themes/reorder の orders 上限（バックエンドの maxItems）
const int reorderBatchLimit = 500;

/// orders を [limit] 件ずつに分ける。sortOrder は全体通しの値のまま。
///
/// バックエンドは各行を個別に update するだけなので、分割して送っても結果は同じ。
List<List<Map<String, int>>> splitReorderOrders(
  List<Map<String, int>> orders, {
  int limit = reorderBatchLimit,
}) {
  if (limit <= 0) throw ArgumentError.value(limit, 'limit', 'must be positive');
  return [
    for (var start = 0; start < orders.length; start += limit)
      orders.sublist(
        start,
        start + limit < orders.length ? start + limit : orders.length,
      ),
  ];
}

/// [items] の [oldIndex] の要素を [newIndex] へ移した新しいリストを返す。
///
/// [newIndex] は ReorderableListView.onReorder の値そのまま（下へ動かすときは
/// 「取り除く前の」挿入位置）を受け取り、ここで補正する。
///
/// [groupOf] を渡すと、同じグループ（同じ値）の要素が並ぶ範囲の中でしか
/// 動かせない。範囲外へ動かそうとした場合は null を返す（呼び出し側で通知する）。
/// テーマの並び替えでは categoryId をグループにし、カテゴリをまたぐ移動を防ぐ
/// （sortOrder だけ変えてもカテゴリは変わらず、保存後に元のカテゴリへ戻って見えるため）。
List<T>? moveItem<T>(
  List<T> items,
  int oldIndex,
  int newIndex, {
  Object? Function(T item)? groupOf,
}) {
  if (oldIndex < 0 || oldIndex >= items.length) return null;
  var target = newIndex > oldIndex ? newIndex - 1 : newIndex;
  if (target < 0) target = 0;
  if (target > items.length - 1) target = items.length - 1;

  final result = List<T>.of(items);
  final moved = result.removeAt(oldIndex);

  if (groupOf != null) {
    final group = groupOf(moved);
    int? first;
    int? last;
    for (var i = 0; i < result.length; i++) {
      if (groupOf(result[i]) == group) {
        first ??= i;
        last = i;
      }
    }
    if (first == null || last == null) {
      // グループに自分しかいない：元の位置以外は不可
      if (target != oldIndex) return null;
    } else if (target < first || target > last + 1) {
      return null;
    }
  }

  result.insert(target, moved);
  return result;
}
