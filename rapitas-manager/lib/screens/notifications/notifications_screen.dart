import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../providers/notification_provider.dart';
import '../../providers/service_providers.dart';
import '../../utils/date_formatter.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificationsAsync = ref.watch(notificationListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('通知'),
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(notificationListProvider),
        child: notificationsAsync.when(
          data: (notifications) {
            if (notifications.isEmpty) {
              return const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.notifications_off, size: 64, color: Colors.grey),
                    SizedBox(height: 16),
                    Text('通知はありません'),
                  ],
                ),
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(8),
              itemCount: notifications.length,
              itemBuilder: (context, index) {
                final notification = notifications[index];
                return Dismissible(
                  key: Key(notification.id),
                  direction: DismissDirection.endToStart,
                  background: Container(
                    alignment: Alignment.centerRight,
                    padding: const EdgeInsets.only(right: 16),
                    color: Colors.red,
                    child: const Icon(Icons.delete, color: Colors.white),
                  ),
                  onDismissed: (_) async {
                    await ref.read(notificationServiceProvider).deleteNotification(notification.id);
                    ref.invalidate(notificationListProvider);
                  },
                  child: Card(
                    color: notification.isRead
                        ? null
                        : Theme.of(context).colorScheme.primaryContainer.withOpacity(0.2),
                    child: ListTile(
                      leading: Icon(
                        _typeIcon(notification.type),
                        color: notification.isRead ? Colors.grey : Theme.of(context).colorScheme.primary,
                      ),
                      title: Text(
                        notification.title,
                        style: TextStyle(
                          fontWeight: notification.isRead ? FontWeight.normal : FontWeight.bold,
                        ),
                      ),
                      subtitle: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          if (notification.message != null)
                            Text(notification.message!, maxLines: 2, overflow: TextOverflow.ellipsis),
                          Text(
                            DateFormatter.formatRelative(notification.createdAt),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                      onTap: () async {
                        if (!notification.isRead) {
                          await ref.read(notificationServiceProvider).markAsRead(notification.id);
                          ref.invalidate(notificationListProvider);
                        }
                      },
                    ),
                  ),
                );
              },
            );
          },
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('通知の取得に失敗しました'),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: () => ref.invalidate(notificationListProvider),
                  child: const Text('再試行'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  IconData _typeIcon(String type) {
    switch (type) {
      case 'execution-complete':
        return Icons.check_circle;
      case 'approval-request':
        return Icons.approval;
      case 'question-asked':
        return Icons.help;
      case 'task-update':
        return Icons.task;
      default:
        return Icons.notifications;
    }
  }
}
