import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../providers/task_provider.dart';
import '../../providers/execution_provider.dart';
import '../../providers/approval_provider.dart';
import '../../providers/notification_provider.dart';
import '../../providers/connection_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/sse_service.dart';
import '../../widgets/task_card.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unreadCount = ref.watch(unreadNotificationCountProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Rapitas Mobile'),
        actions: [
          IconButton(
            icon: Badge(
              isLabelVisible: unreadCount > 0,
              label: Text('$unreadCount'),
              child: const Icon(Icons.notifications_outlined),
            ),
            onPressed: () => context.push(AppRoutes.notifications),
          ),
          IconButton(
            icon: const Icon(Icons.dashboard_outlined),
            onPressed: () => context.push(AppRoutes.dashboard),
          ),
        ],
      ),
      body: Column(
        children: [
          const _ConnectionStatusBar(),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(taskListProvider);
                ref.invalidate(executingTasksProvider);
                ref.invalidate(approvalListProvider);
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _SectionHeader(
                    title: '進行中のタスク',
                    onSeeAll: () => context.go(AppRoutes.tasks),
                  ),
                  _ActiveTasksSection(),
                  const SizedBox(height: 24),
                  _SectionHeader(
                    title: '実行中のエージェント',
                    onSeeAll: () => context.go(AppRoutes.executions),
                  ),
                  _RunningExecutionsSection(),
                  const SizedBox(height: 24),
                  _SectionHeader(
                    title: '保留中の承認',
                    onSeeAll: () => context.go(AppRoutes.approvals),
                  ),
                  _PendingApprovalsSection(),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// ホーム先頭の細い帯。デスクトップとのリアルタイム接続（SSE）の状態を出し、タップで設定画面へ。
class _ConnectionStatusBar extends ConsumerWidget {
  const _ConnectionStatusBar();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final sseState = ref.watch(sseConnectionStateProvider).valueOrNull ?? SseConnectionState.idle;
    final desktopName = ref.watch(connectionSettingsProvider.select((s) => s.desktopName));

    final (Color dotColor, String label) = switch (sseState) {
      SseConnectionState.connected => (Colors.green, '接続中（${desktopName ?? 'デスクトップ'}）'),
      SseConnectionState.connecting => (Colors.orange, '接続しています'),
      SseConnectionState.reconnecting => (Colors.orange, '再接続しています'),
      SseConnectionState.unauthorized => (Colors.grey, '未接続（QRコードでつなぎ直してください）'),
      SseConnectionState.idle => (Colors.grey, '未接続'),
    };
    final colorScheme = Theme.of(context).colorScheme;

    return Material(
      color: colorScheme.surfaceContainerHighest,
      child: InkWell(
        onTap: () => context.go(AppRoutes.settings),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Row(
            children: [
              Container(
                width: 8,
                height: 8,
                decoration: BoxDecoration(color: dotColor, shape: BoxShape.circle),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: colorScheme.onSurfaceVariant,
                      ),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              Icon(Icons.chevron_right, size: 16, color: colorScheme.onSurfaceVariant),
            ],
          ),
        ),
      ),
    );
  }
}

/// セクションの取得失敗を示す短いエラー行。再試行で該当 provider を読み直す。
class _SectionErrorRow extends StatelessWidget {
  final VoidCallback onRetry;

  const _SectionErrorRow({required this.onRetry});

  @override
  Widget build(BuildContext context) {
    final colorScheme = Theme.of(context).colorScheme;
    return Card(
      child: Padding(
        padding: const EdgeInsets.only(left: 16, right: 8),
        child: Row(
          children: [
            Icon(Icons.error_outline, size: 20, color: colorScheme.error),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                '取得できませんでした',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ),
            TextButton(
              onPressed: onRetry,
              child: const Text('再試行'),
            ),
          ],
        ),
      ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final VoidCallback? onSeeAll;

  const _SectionHeader({required this.title, this.onSeeAll});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
          ),
          if (onSeeAll != null)
            TextButton(
              onPressed: onSeeAll,
              child: const Text('すべて表示'),
            ),
        ],
      ),
    );
  }
}

class _ActiveTasksSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tasksAsync = ref.watch(
      taskListProvider(const TaskFilter(status: 'in-progress')),
    );

    return tasksAsync.when(
      data: (tasks) {
        if (tasks.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('進行中のタスクはありません')),
            ),
          );
        }
        return Column(
          children: tasks.take(5).map((task) {
            return TaskCard(
              task: task,
              onTap: () => context.push('/tasks/${task.id}'),
            );
          }).toList(),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Card(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Center(
            child: Column(
              children: [
                const Icon(Icons.cloud_off, size: 48, color: Colors.grey),
                const SizedBox(height: 8),
                Text('接続エラー', style: Theme.of(context).textTheme.bodyMedium),
                Text(
                  'バックエンドに接続できません',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _RunningExecutionsSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final executingAsync = ref.watch(executingTasksProvider);
    final titles = ref.watch(taskTitleLookupProvider);

    return executingAsync.when(
      data: (executing) {
        if (executing.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('実行中のエージェントはありません')),
            ),
          );
        }
        return Column(
          children: executing.take(3).map((task) {
            return Card(
              child: ListTile(
                leading: task.isWaitingForInput
                    ? const Icon(Icons.help_outline, color: Colors.orange)
                    : const SizedBox(
                        width: 24,
                        height: 24,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                title: Text(
                  taskTitleOrFallback(titles, task.taskId),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(task.isWaitingForInput ? '入力待ち' : '実行中'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/tasks/${task.taskId}'),
              ),
            );
          }).toList(),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => _SectionErrorRow(
        onRetry: () => ref.invalidate(executingTasksProvider),
      ),
    );
  }
}

class _PendingApprovalsSection extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final approvalsAsync = ref.watch(approvalListProvider);

    return approvalsAsync.when(
      data: (approvals) {
        final pending = approvals.where((a) => a.isPending).toList();
        if (pending.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('保留中の承認リクエストはありません')),
            ),
          );
        }
        return Column(
          children: pending.take(3).map((approval) {
            return Card(
              color: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
              child: ListTile(
                leading: const Icon(Icons.approval, color: Colors.orange),
                title: Text(approval.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: approval.description != null
                    ? Text(approval.description!, maxLines: 1, overflow: TextOverflow.ellipsis)
                    : null,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.go(AppRoutes.approvals),
              ),
            );
          }).toList(),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => _SectionErrorRow(
        onRetry: () => ref.invalidate(approvalListProvider),
      ),
    );
  }
}
