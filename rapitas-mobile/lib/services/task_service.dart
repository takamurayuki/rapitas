import '../models/task.dart';
import 'api_client.dart';

class TaskService {
  final ApiClient _client;

  TaskService(this._client);

  Future<List<Task>> getTasks({
    String? projectId,
    String? milestoneId,
    String? priority,
    String? status,
    String? themeId,
    String? parentId,
  }) async {
    final queryParams = <String, dynamic>{};
    if (projectId != null) queryParams['projectId'] = projectId;
    if (milestoneId != null) queryParams['milestoneId'] = milestoneId;
    if (priority != null) queryParams['priority'] = priority;
    if (status != null) queryParams['status'] = status;
    if (themeId != null) queryParams['themeId'] = themeId;
    if (parentId != null) queryParams['parentId'] = parentId;

    final response = await _client.get('/tasks', queryParameters: queryParams);
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['tasks'] ?? []);
    return data.map((json) => Task.fromJson(json)).toList();
  }

  Future<Task> getTask(String id) async {
    final response = await _client.get('/tasks/$id');
    return Task.fromJson(response.data);
  }

  Future<Task> createTask(Map<String, dynamic> data) async {
    final response = await _client.post('/tasks', data: data);
    return Task.fromJson(response.data);
  }

  Future<Task> updateTask(String id, Map<String, dynamic> data) async {
    final response = await _client.patch('/tasks/$id', data: data);
    return Task.fromJson(response.data);
  }

  Future<void> deleteTask(String id) async {
    await _client.delete('/tasks/$id');
  }

  Future<List<Task>> searchTasks(String query) async {
    final response = await _client.get('/tasks/search', queryParameters: {'q': query});
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['tasks'] ?? []);
    return data.map((json) => Task.fromJson(json)).toList();
  }
}
