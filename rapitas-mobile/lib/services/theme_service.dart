import 'api_client.dart';
import 'reorder_orders.dart';
import '../models/task.dart';

class ThemeService {
  final ApiClient _client;

  ThemeService(this._client);

  Future<List<TaskTheme>> getThemes() async {
    final response = await _client.get('/themes');
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['themes'] ?? []);
    return data.map((json) => TaskTheme.fromJson(json)).toList();
  }

  Future<TaskTheme> createTheme(Map<String, dynamic> data) async {
    final response = await _client.post('/themes', data: data);
    return TaskTheme.fromJson(response.data);
  }

  Future<TaskTheme> updateTheme(String id, Map<String, dynamic> data) async {
    final response = await _client.patch('/themes/$id', data: data);
    return TaskTheme.fromJson(response.data);
  }

  Future<void> deleteTheme(String id) async {
    await _client.delete('/themes/$id');
  }

  /// 表示順どおりの id 一覧で並び順を保存する（PATCH /themes/reorder）。
  /// バックエンドの上限（500件）を超える場合は分割して送る。
  Future<void> reorderThemes(List<String> orderedIds) async {
    final orders = buildReorderOrders(orderedIds);
    for (final batch in splitReorderOrders(orders)) {
      await _client.patch('/themes/reorder', data: {'orders': batch});
    }
  }
}
