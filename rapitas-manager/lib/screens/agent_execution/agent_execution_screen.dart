import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/execution_provider.dart';
import '../../providers/task_provider.dart';
import '../../providers/service_providers.dart';
import '../../services/voice_command_parser.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/voice_input_sheet.dart';
import '../../utils/date_formatter.dart';
import '../../widgets/execution_log_viewer.dart';

class AgentExecutionScreen extends ConsumerWidget {
  const AgentExecutionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final executionsAsync = ref.watch(executionListProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('エージェント実行'),
        actions: [
          IconButton(
            icon: const Icon(Icons.mic),
            tooltip: '音声でタスクを実行',
            onPressed: () => _handleVoiceExecution(context, ref),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(executionListProvider),
        child: executionsAsync.when(
          data: (executions) {
            if (executions.isEmpty) {
              return const Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.smart_toy_outlined, size: 64, color: Colors.grey),
                    SizedBox(height: 16),
                    Text('実行履歴はありません'),
                  ],
                ),
              );
            }
            return ListView.builder(
              padding: const EdgeInsets.all(8),
              itemCount: executions.length,
              itemBuilder: (context, index) {
                final execution = executions[index];
                return Card(
                  child: ExpansionTile(
                    leading: _statusIcon(execution.status),
                    title: Text(
                      execution.task?.title ?? execution.command ?? '実行 #${execution.id.substring(0, 8)}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                    subtitle: Row(
                      children: [
                        StatusBadge.execution(status: execution.status),
                        const SizedBox(width: 8),
                        Text(
                          execution.durationText,
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        if (execution.tokensUsed != null) ...[
                          const SizedBox(width: 8),
                          Text(
                            '${execution.tokensUsed}トークン',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ],
                    ),
                    trailing: execution.isRunning
                        ? IconButton(
                            icon: const Icon(Icons.stop, color: Colors.red),
                            onPressed: () => _cancelExecution(context, ref, execution.id),
                          )
                        : Text(
                            DateFormatter.formatRelative(execution.createdAt),
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                    children: [
                      if (execution.hasQuestion)
                        Container(
                          padding: const EdgeInsets.all(16),
                          color: Theme.of(context).colorScheme.primaryContainer.withOpacity(0.2),
                          child: Row(
                            children: [
                              const Icon(Icons.help, color: Colors.orange),
                              const SizedBox(width: 8),
                              Expanded(child: Text(execution.question!)),
                            ],
                          ),
                        ),
                      if (execution.output != null && execution.output!.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.all(16),
                          child: Text(
                            execution.output!,
                            style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                          ),
                        ),
                      if (execution.errorMessage != null)
                        Container(
                          padding: const EdgeInsets.all(16),
                          color: Colors.red.withOpacity(0.1),
                          child: Text(
                            execution.errorMessage!,
                            style: const TextStyle(color: Colors.red, fontSize: 12),
                          ),
                        ),
                      Padding(
                        padding: const EdgeInsets.all(8),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.end,
                          children: [
                            if (execution.status == 'interrupted')
                              TextButton.icon(
                                icon: const Icon(Icons.play_arrow),
                                label: const Text('再開'),
                                onPressed: () => _resumeExecution(context, ref, execution.id),
                              ),
                            TextButton.icon(
                              icon: const Icon(Icons.article),
                              label: const Text('ログ'),
                              onPressed: () => _showLogs(context, ref, execution.id),
                            ),
                          ],
                        ),
                      ),
                    ],
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
                const Text('実行履歴の取得に失敗しました'),
                const SizedBox(height: 8),
                ElevatedButton(
                  onPressed: () => ref.invalidate(executionListProvider),
                  child: const Text('再試行'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  void _handleVoiceExecution(BuildContext context, WidgetRef ref) async {
    final command = await VoiceInputSheet.show(
      context,
      expectedType: VoiceCommandType.executeTask,
      hint: '「実行」と話すか、実行するタスク名を話してください',
    );

    if (command == null || !context.mounted) return;

    if (command.type == VoiceCommandType.executeTask ||
        command.type == VoiceCommandType.createTask) {
      // タスク名で検索して実行候補を表示
      await _showTaskSelectionForExecution(context, ref, command.rawText);
    }
  }

  Future<void> _showTaskSelectionForExecution(
    BuildContext context,
    WidgetRef ref,
    String query,
  ) async {
    try {
      final taskService = ref.read(taskServiceProvider);
      List<Task> tasks;

      // クエリが単純な実行コマンドの場合は実行可能なタスク一覧を取得
      final isSimpleExecute = RegExp(r'^(?:実行|自動実行|エージェント実行)(?:して|する)?$').hasMatch(query.trim());
      if (isSimpleExecute) {
        tasks = await taskService.getTasks(status: 'todo');
      } else {
        tasks = await taskService.searchTasks(query);
        if (tasks.isEmpty) {
          tasks = await taskService.getTasks(status: 'todo');
        }
      }

      final executableTasks = tasks.where((t) => t.agentExecutable || t.isDeveloperMode).toList();

      if (!context.mounted) return;

      if (executableTasks.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('実行可能なタスクが見つかりませんでした')),
        );
        return;
      }

      final selected = await showDialog<Task>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('実行するタスクを選択'),
          content: SizedBox(
            width: double.maxFinite,
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: executableTasks.length,
              itemBuilder: (context, index) {
                final task = executableTasks[index];
                return ListTile(
                  title: Text(task.title, maxLines: 2, overflow: TextOverflow.ellipsis),
                  subtitle: Text(task.status),
                  leading: const Icon(Icons.smart_toy),
                  onTap: () => Navigator.pop(context, task),
                );
              },
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('キャンセル'),
            ),
          ],
        ),
      );

      if (selected == null || !context.mounted) return;

      // 確認ダイアログ
      final confirmed = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('タスクを実行'),
          content: Text('「${selected.title}」をAIエージェントで実行しますか？'),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('キャンセル')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('実行')),
          ],
        ),
      );

      if (confirmed != true || !context.mounted) return;

      await ref.read(agentServiceProvider).executeTask(selected.id);
      ref.invalidate(executionListProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('「${selected.title}」の実行を開始しました')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('実行に失敗しました: $e')),
        );
      }
    }
  }

  Widget _statusIcon(String status) {
    switch (status) {
      case 'running':
        return const SizedBox(
          width: 24,
          height: 24,
          child: CircularProgressIndicator(strokeWidth: 2),
        );
      case 'completed':
        return const Icon(Icons.check_circle, color: Colors.green);
      case 'failed':
        return const Icon(Icons.error, color: Colors.red);
      case 'cancelled':
        return const Icon(Icons.cancel, color: Colors.orange);
      case 'interrupted':
        return const Icon(Icons.pause_circle, color: Colors.amber);
      default:
        return const Icon(Icons.hourglass_empty, color: Colors.grey);
    }
  }

  Future<void> _cancelExecution(BuildContext context, WidgetRef ref, String id) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('実行キャンセル'),
        content: const Text('この実行をキャンセルしますか？'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('いいえ')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('はい')),
        ],
      ),
    );

    if (confirmed == true) {
      try {
        await ref.read(agentServiceProvider).cancelExecution(id);
        ref.invalidate(executionListProvider);
      } catch (e) {
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('キャンセルに失敗しました: $e')),
          );
        }
      }
    }
  }

  Future<void> _resumeExecution(BuildContext context, WidgetRef ref, String id) async {
    try {
      await ref.read(agentServiceProvider).resumeExecution(id);
      ref.invalidate(executionListProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('実行を再開しました')),
        );
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('再開に失敗しました: $e')),
        );
      }
    }
  }

  void _showLogs(BuildContext context, WidgetRef ref, String id) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      builder: (context) {
        return DraggableScrollableSheet(
          initialChildSize: 0.7,
          minChildSize: 0.3,
          maxChildSize: 0.95,
          expand: false,
          builder: (context, scrollController) {
            return Consumer(
              builder: (context, ref, _) {
                final logsAsync = ref.watch(executionLogsProvider(id));
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text('実行ログ', style: Theme.of(context).textTheme.titleMedium),
                          IconButton(
                            icon: const Icon(Icons.close),
                            onPressed: () => Navigator.pop(context),
                          ),
                        ],
                      ),
                    ),
                    Expanded(
                      child: logsAsync.when(
                        data: (logs) => ExecutionLogViewer(
                          logs: logs,
                          scrollController: scrollController,
                        ),
                        loading: () => const Center(child: CircularProgressIndicator()),
                        error: (e, _) => Center(child: Text('ログの取得に失敗しました: $e')),
                      ),
                    ),
                  ],
                );
              },
            );
          },
        );
      },
    );
  }
}
