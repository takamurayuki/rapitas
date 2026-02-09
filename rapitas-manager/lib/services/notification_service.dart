import '../models/notification_model.dart';
import 'api_client.dart';

class NotificationService {
  final ApiClient _client;

  NotificationService(this._client);

  Future<List<AppNotification>> getNotifications() async {
    final response = await _client.get('/notifications');
    final List<dynamic> data = response.data is List
        ? response.data
        : (response.data['notifications'] ?? []);
    return data.map((json) => AppNotification.fromJson(json)).toList();
  }

  Future<void> markAsRead(String id) async {
    await _client.patch('/notifications/$id/read');
  }

  Future<void> deleteNotification(String id) async {
    await _client.delete('/notifications/$id');
  }
}
