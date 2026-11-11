import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../models/task.dart';
import '../../providers/execution_provider.dart';
import '../../providers/task_provider.dart';
import '../../providers/service_providers.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/priority_indicator.dart';
import '../../utils/date_formatter.dart';
import '../../utils/constants.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../widgets/markdown/task_description_markdown.dart';

class TaskDetailScreen extends ConsumerWidget {
  final String taskId;

  const TaskDetailScreen({super.key, required this.taskId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final taskAsync = ref.watch(taskDetailProvider(taskId));
    final loadedTask = taskAsync.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: const Text('タスク詳細'),
        actions: [
          // 読み込み前は右にアイコンが無いので右端用の余白を取る
          VoiceModeIndicator(trailing: loadedTask == null),
          if (loadedTask != null && loadedTask.canExecuteWithAgent)
            IconButton(
              icon: const Icon(Icons.play_arrow),
              tooltip: 'AIエージェントで実行',
              onPressed: () => _executeWithAgent(context, ref),
            ),
          if (loadedTask != null) ...[
            IconButton(
              icon: const Icon(Icons.edit),
              tooltip: '編集',
              onPressed: () => context.push('/tasks/$taskId/edit', extra: loadedTask),
            ),
            PopupMenuButton<String>(
              onSelected: (value) {
                if (value == 'delete') _deleteTask(context, ref, loadedTask);
              },
              itemBuilder: (context) => [
                PopupMenuItem<String>(
                  value: 'delete',
                  child: Row(
                    children: [
                      Icon(Icons.delete_outline, color: Theme.of(context).colorScheme.error),
                      const SizedBox(width: 12),
                      Text(
                        '削除',
                        style: TextStyle(color: Theme.of(context).colorScheme.error),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ],
        ],
      ),
      body: VoiceScrollTarget(
        path: AppRoutes.taskDetail,
        // 読み込み失敗の表示（引っ張って更新が無い）からも「更新」で読み直せるよう、直接 invalidate する
        onRefresh: () async => ref.invalidate(taskDetailProvider(taskId)),
        child: taskAsync.when(
          data: (task) => RefreshIndicator(
            onRefresh: () async => ref.invalidate(taskDetailProvider(taskId)),
            child: ListView(
              padding: const EdgeInsets.all(16),
              children: [
                Text(
                  task.title,
                  style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    StatusBadge.task(status: task.status),
                    const SizedBox(width: 12),
                    PriorityIndicator(priority: task.priority),
                  ],
                ),
                const SizedBox(height: 16),
                // Status change buttons
                Row(
                  children: [
                    for (final status in ['todo', 'in-progress', 'done'])
                      Padding(
                        padding: const EdgeInsets.only(right: 8),
                        child: ChoiceChip(
                          label: Text(AppConstants.statusLabels[status]!),
                          selected: task.status == status,
                          onSelected: task.status == status
                              ? null
                              : (_) => _updateStatus(ref, status),
                        ),
                      ),
                  ],
                ),
                if (task.description != null && task.description!.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text('説明', style: Theme.of(context).textTheme.titleSmall),
                  const SizedBox(height: 8),
                  // NOTE: Rendered as Markdown here only; list previews and the edit
                  // form deliberately stay plain text.
                  TaskDescriptionMarkdown(data: task.description!),
                ],
                const SizedBox(height: 24),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      children: [
                        _DetailRow(
                          icon: Icons.calendar_today,
                          label: '期日',
                          value: DateFormatter.formatDate(task.dueDate),
                        ),
                        _DetailRow(
                          icon: Icons.access_time,
                          label: '見積もり',
                          value: task.estimatedHours != null
                              ? '${task.estimatedHours}時間'
                              : '-',
                        ),
                        _DetailRow(
                          icon: Icons.timer,
                          label: '実績',
                          value: task.actualHours != null
                              ? '${task.actualHours}時間'
                              : '-',
                        ),
                        _DetailRow(
                          icon: Icons.folder,
                          label: 'テーマ',
                          value: task.theme?.name ?? '-',
                        ),
                        _DetailRow(
                          icon: Icons.play_circle,
                          label: '開始',
                          value: DateFormatter.formatDateTime(task.startedAt),
                        ),
                        _DetailRow(
                          icon: Icons.check_circle,
                          label: '完了',
                          value: DateFormatter.formatDateTime(task.completedAt),
                        ),
                      ],
                    ),
                  ),
                ),
                if (task.subtasks != null && task.subtasks!.isNotEmpty) ...[
                  const SizedBox(height: 24),
                  Text(
                    'サブタスク (${task.subtasks!.length})',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                  const SizedBox(height: 8),
                  ...task.subtasks!.map((subtask) => Card(
                        child: ListTile(
                          leading: Icon(
                            subtask.status == 'done'
                                ? Icons.check_circle
                                : Icons.radio_button_unchecked,
                            color: subtask.status == 'done'
                                ? Colors.green
                                : Colors.grey,
                          ),
                          title: Text(subtask.title),
                          subtitle: Text(
                            AppConstants.statusLabels[subtask.status] ?? subtask.status,
                          ),
                          onTap: () => _toggleSubtask(context, ref, subtask),
                        ),
                      )),
                ],
                if (task.canExecuteWithAgent) ...[
                  const SizedBox(height: 24),
                  Card(
                    color: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.3),
                    child: Padding(
                      padding: const EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(Icons.smart_toy, color: Theme.of(context).colorScheme.primary),
                              const SizedBox(width: 8),
                              Text(
                                'AI実行可能',
                                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                                      fontWeight: FontWeight.bold,
                                    ),
                              ),
                            ],
                          ),
                          if (task.executionInstructions != null) ...[
                            const SizedBox(height: 8),
                            Text(task.executionInstructions!),
                          ],
                          const SizedBox(height: 12),
                          FilledButton.icon(
                            onPressed: () => _executeWithAgent(context, ref),
                            icon: const Icon(Icons.play_arrow),
                            label: const Text('エージェントで実行'),
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ],
            ),
          ),
          loading: () => const Center(child: CircularProgressIndicator()),
          error: (error, _) => Center(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.error_outline, size: 64, color: Colors.red),
                const SizedBox(height: 16),
                const Text('タスクの取得に失敗しました'),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: () => ref.invalidate(taskDetailProvider(taskId)),
                  child: const Text('再試行'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  Future<void> _updateStatus(WidgetRef ref, String status) async {
    final service = ref.read(taskServiceProvider);
    await service.updateTask(taskId, {'status': status});
    ref.invalidate(taskDetailProvider(taskId));
    ref.invalidate(taskListProvider);
  }

  Future<void> _toggleSubtask(BuildContext context, WidgetRef ref, Task subtask) async {
    final next = subtask.status == 'done' ? 'todo' : 'done';
    // 画面が破棄されても invalidate できるよう、await の前にコンテナを捕捉する
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final service = ref.read(taskServiceProvider);
      await service.updateTask(subtask.id, {'status': next});
      container.invalidate(taskDetailProvider(taskId));
      container.invalidate(taskListProvider);
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('サブタスクの更新に失敗しました: $e')),
        );
      }
    }
  }

  Future<void> _deleteTask(BuildContext context, WidgetRef ref, Task task) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('タスクを削除'),
        content: Text('「${task.title}」を削除しますか？\nこの操作は取り消せません。'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
              foregroundColor: Theme.of(context).colorScheme.onError,
            ),
            onPressed: () => Navigator.pop(context, true),
            child: const Text('削除'),
          ),
        ],
      ),
    );

    if (confirmed != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    // 画面が破棄されても invalidate できるよう、await の前にコンテナを捕捉する
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final service = ref.read(taskServiceProvider);
      await service.deleteTask(taskId);
      container.invalidate(taskListProvider);
      if (!context.mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('タスク「${task.title}」を削除しました')),
      );
      if (context.canPop()) {
        context.pop();
      } else {
        context.go(AppRoutes.tasks);
      }
    } catch (e) {
      if (!context.mounted) return;
      messenger.showSnackBar(
        SnackBar(content: Text('タスクの削除に失敗しました: $e')),
      );
    }
  }

  Future<void> _executeWithAgent(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('AI実行の確認'),
        content: const Text('このタスクをAIエージェントで実行しますか？'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('キャンセル'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('実行'),
          ),
        ],
      ),
    );

    // ダイアログ表示中に画面が破棄されていたら ref / context は使えない
    if (confirmed != true || !context.mounted) return;
    // await 中に画面を離れても、サーバー側の状態は変わるのでキャッシュは読み直す。
    // そのため WidgetRef ではなく、await 前に控えた container から invalidate する。
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      final service = container.read(agentServiceProvider);
      final result = await service.executeTask(taskId);
      container.invalidate(executingTasksProvider);
      container.invalidate(taskDetailProvider(taskId));
      container.invalidate(taskListProvider);
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          // 仕様が薄い draft タスクは質問を作るだけで止まる（エージェントは未起動）
          content: Text(result.isAwaitingQuestion
              ? (result.message ?? '仕様確認の質問を作成しました')
              : 'エージェント実行を開始しました'),
        ),
      );
    } catch (e) {
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('実行に失敗しました: $e')),
      );
    }
  }
}

class _DetailRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final String value;

  const _DetailRow({
    required this.icon,
    required this.label,
    required this.value,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 18, color: Theme.of(context).colorScheme.onSurface.withOpacity(0.5)),
          const SizedBox(width: 8),
          SizedBox(
            width: 80,
            child: Text(
              label,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: Theme.of(context).colorScheme.onSurface.withOpacity(0.6),
                  ),
            ),
          ),
          Expanded(
            child: Text(value, style: Theme.of(context).textTheme.bodyMedium),
          ),
        ],
      ),
    );
  }
}
