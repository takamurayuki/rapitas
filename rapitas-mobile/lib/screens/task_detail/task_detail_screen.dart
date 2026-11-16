import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../config/routes.dart';
import '../../models/companion_digest.dart';
import '../../models/task.dart';
import '../../providers/note_provider.dart';
import '../../providers/task_provider.dart';
import '../../providers/service_providers.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/priority_indicator.dart';
import '../../utils/date_formatter.dart';
import '../../utils/constants.dart';
import '../../widgets/voice_mode_indicator.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../widgets/markdown/task_description_markdown.dart';
import '../../widgets/task_companion_sections.dart';
import '../../widgets/task_notes_section.dart';
import '../../utils/plain_reasons.dart';
import 'subtask_section.dart';
import 'task_execution_controls.dart';
import 'task_inline_edit.dart';

class TaskDetailScreen extends ConsumerWidget {
  final String taskId;

  const TaskDetailScreen({super.key, required this.taskId});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final taskAsync = ref.watch(taskDetailProvider(taskId));
    final loadedTask = taskAsync.valueOrNull;
    final executing = watchTaskExecuting(ref, taskId);
    final runButton = loadedTask == null
        ? null
        : taskExecutionHeaderButton(context, task: loadedTask, executing: executing);

    return TaskExecutionPoller(
      taskId: taskId,
      active: executing,
      child: Scaffold(
        appBar: AppBar(
          title: const Text('タスク詳細'),
          // NOTE: 「…」メニュー（削除のみ）は廃止。削除はタスク一覧の横スワイプに一本化した。
          actions: [
            // 読み込み前は右にアイコンが無いので右端用の余白を取る
            VoiceModeIndicator(trailing: loadedTask == null),
            if (runButton != null) runButton,
            if (loadedTask != null)
              IconButton(
                icon: const Icon(Icons.edit),
                tooltip: '編集',
                onPressed: () => context.push('/tasks/$taskId/edit', extra: loadedTask),
              ),
          ],
          bottom: taskExecutingBar(executing),
        ),
        body: VoiceScrollTarget(
          path: AppRoutes.taskDetail,
          // 読み込み失敗の表示（引っ張って更新が無い）からも「更新」で読み直せるよう、直接 invalidate する
          onRefresh: () async => ref.invalidate(taskDetailProvider(taskId)),
          child: taskAsync.when(
            data: (task) => RefreshIndicator(
              onRefresh: () async {
                ref.invalidate(taskDetailProvider(taskId));
                ref.invalidate(taskNotesProvider(taskId));
              },
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  TaskInlineEditable(
                    taskId: taskId,
                    field: TaskInlineField.title,
                    initialValue: task.title,
                    child: Text(
                      task.title,
                      style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.bold,
                          ),
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
                    TaskInlineEditable(
                      taskId: taskId,
                      field: TaskInlineField.description,
                      initialValue: task.description!,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('説明', style: Theme.of(context).textTheme.titleSmall),
                          const SizedBox(height: 8),
                          // NOTE: Rendered as Markdown here only; list previews and the edit
                          // form deliberately stay plain text.
                          TaskDescriptionMarkdown(data: task.description!),
                        ],
                      ),
                    ),
                  ],
                  // ラピ伴走化 第1段階：何をもって完了とするかと、いまどこにいるか（どちらも DB の値）
                  const SizedBox(height: 24),
                  TaskAcceptanceCriteriaSection(
                    criteria: task.acceptanceCriteria,
                    userChecks: task.userAcceptanceChecks,
                  ),
                  const SizedBox(height: 24),
                  TaskStageSection(
                    workflowStatus: task.workflowStatus,
                    haltReason: task.haltReason,
                  ),
                  // 第2段階：人が決める場面なら判断画面へ（ボタンは画面から直接バックエンドへ送る）
                  if (decisionKindFor(
                          status: task.status,
                          workflowStatus: task.workflowStatus,
                          haltReason: task.haltReason)
                      case final kind?) ...[
                    const SizedBox(height: 12),
                    FilledButton.tonal(
                      key: const ValueKey('task-detail-decide'),
                      onPressed: () => context.push('/tasks/$taskId/decide'),
                      child: Text('判断する：${decisionCopy(kind).title}'),
                    ),
                  ],
                  // 紐づくノート（成果物・説明資料）。中身は別ファイル（この画面はすでに大きい）
                  const SizedBox(height: 24),
                  TaskNotesSection(taskId: taskId),
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
                          // NOTE: play_circle は「AI実行」に充てたので、開始日時は別のグリフにする
                          _DetailRow(
                            icon: Icons.start,
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
                  // NOTE: 0 件でも出す。以前は 0 件だと欄ごと無く、最初のサブタスクを作れなかった
                  const SizedBox(height: 24),
                  SubtaskSection(
                    task: task,
                    onToggle: (subtask) => _toggleSubtask(context, ref, subtask),
                  ),
                  // NOTE: 実行ボタンはヘッダーに固定した。カードは実行指示の表示用に残す。
                  if (task.canExecuteWithAgent || executing) ...[
                    const SizedBox(height: 24),
                    TaskExecutionInfoCard(task: task, executing: executing),
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
