import 'api_client.dart';
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
}
