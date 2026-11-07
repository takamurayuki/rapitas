import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../models/notification_model.dart';
import 'service_providers.dart';

final notificationListProvider = FutureProvider<List<AppNotification>>((ref) async {
  final service = ref.watch(notificationServiceProvider);
  return service.getNotifications();
});

final unreadNotificationCountProvider = Provider<int>((ref) {
  final notifications = ref.watch(notificationListProvider);
  return notifications.whenOrNull(
    data: (list) => list.where((n) => !n.isRead).length,
  ) ?? 0;
});
