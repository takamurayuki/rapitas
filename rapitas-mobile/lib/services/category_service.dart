import 'api_client.dart';
import 'reorder_orders.dart';
import '../models/task.dart';

class CategoryService {
  final ApiClient _client;

  CategoryService(this._client);

  /// カテゴリ一覧（バックエンドで sortOrder 昇順）
  Future<List<TaskCategory>> getCategories() async {
    final response = await _client.get('/categories');
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['categories'] ?? []);
    return data
        .map((json) => TaskCategory.fromJson(Map<String, dynamic>.from(json)))
        .toList();
  }

  Future<TaskCategory> createCategory(Map<String, dynamic> data) async {
    final response = await _client.post('/categories', data: data);
    return TaskCategory.fromJson(Map<String, dynamic>.from(response.data));
  }

  Future<TaskCategory> updateCategory(String id, Map<String, dynamic> data) async {
    final response = await _client.patch('/categories/$id', data: data);
    return TaskCategory.fromJson(Map<String, dynamic>.from(response.data));
  }

  /// カテゴリを削除する（DELETE /categories/:id）。初期投入の「開発」「学習」も削除できる。
  /// 所属テーマは消えずカテゴリなしになる（バックエンドの onDelete: SetNull）
  Future<void> deleteCategory(String id) async {
    await _client.delete('/categories/$id');
  }

  /// ☆（既定カテゴリ）の ID。GET /categories/default-category（UserSettings.defaultCategoryId）。
  /// 未設定・削除済みなら null。PC 版のカテゴリ画面の ☆ と同じ情報源
  Future<String?> getDefaultCategoryId() async {
    final response = await _client.get('/categories/default-category');
    final data = response.data;
    final id = data is Map ? data['defaultCategoryId'] : null;
    return id?.toString();
  }

  /// カテゴリを ☆（既定カテゴリ）にする（PATCH /categories/:id/set-default）
  Future<void> setDefaultCategory(String id) async {
    await _client.patch('/categories/$id/set-default');
  }

  /// 表示順どおりの id 一覧で並び順を保存する（PATCH /categories/reorder）
  Future<void> reorderCategories(List<String> orderedIds) async {
    final orders = buildReorderOrders(orderedIds);
    for (final batch in splitReorderOrders(orders)) {
      await _client.patch('/categories/reorder', data: {'orders': batch});
    }
  }
}
