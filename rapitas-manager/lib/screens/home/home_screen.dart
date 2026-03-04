import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../providers/task_provider.dart';
import '../../providers/execution_provider.dart';
import '../../providers/approval_provider.dart';
import '../../providers/notification_provider.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final unreadCount = ref.watch(unreadNotificationCountProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Rapitas Manager'),
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
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(taskListProvider);
          ref.invalidate(executionListProvider);
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
            return Card(
              child: ListTile(
                title: Text(task.title, maxLines: 1, overflow: TextOverflow.ellipsis),
                subtitle: task.description != null
                    ? Text(task.description!, maxLines: 1, overflow: TextOverflow.ellipsis)
                    : null,
                trailing: task.agentExecutable
                    ? Icon(Icons.smart_toy, color: Theme.of(context).colorScheme.primary)
                    : null,
                onTap: () => context.push('/tasks/${task.id}'),
              ),
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
    final executionsAsync = ref.watch(executionListProvider);

    return executionsAsync.when(
      data: (executions) {
        final running = executions.where((e) => e.isRunning).toList();
        if (running.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: Text('実行中のエージェントはありません')),
            ),
          );
        }
        return Column(
          children: running.take(3).map((execution) {
            return Card(
              child: ListTile(
                leading: const SizedBox(
                  width: 24,
                  height: 24,
                  child: CircularProgressIndicator(strokeWidth: 2),
                ),
                title: Text(
                  execution.task?.title ?? execution.command ?? '実行中...',
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                subtitle: Text(execution.durationText),
              ),
            );
          }).toList(),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => const SizedBox.shrink(),
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
              ),
            );
          }).toList(),
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (_, __) => const SizedBox.shrink(),
    );
  }
}
