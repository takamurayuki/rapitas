import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../models/task_execution.dart';
import '../../providers/execution_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';
import '../../services/voice_command_parser.dart';
import '../../widgets/status_badge.dart';
import '../../widgets/voice_input_sheet.dart';
import '../../widgets/execution_log_viewer.dart';

/// 実行中のタスクと、中断されて再開できる実行の2セクション。
/// どちらもタスク中心の実在API（/tasks/executing, /agents/resumable-executions）から取る。
class AgentExecutionScreen extends ConsumerWidget {
  const AgentExecutionScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final executingAsync = ref.watch(executingTasksProvider);
    final resumableAsync = ref.watch(resumableExecutionsProvider);
    final titles = ref.watch(taskTitleLookupProvider);

    // 両方とも取得でき、どちらも空のときだけ全体の空状態にする。
    // 片方が失敗・読み込み中なら、セクションごとに状態を出す。
    final executing = executingAsync.valueOrNull;
    final resumable = resumableAsync.valueOrNull
        ?.where((e) => e.canResume)
        .toList();
    final allEmpty = !executingAsync.hasError &&
        !resumableAsync.hasError &&
        executing != null &&
        resumable != null &&
        executing.isEmpty &&
        resumable.isEmpty;

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
      // タップで開ける実行導線。音声の単純実行コマンドと同じ経路（todo の実行可能タスク一覧）を使う。
      floatingActionButton: FloatingActionButton.extended(
        heroTag: 'execute_task',
        icon: const Icon(Icons.play_arrow),
        label: const Text('タスクを実行'),
        onPressed: () => _showTaskSelectionForExecution(context, ref, '実行'),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(taskListProvider);
          _invalidateExecutions(
              ProviderScope.containerOf(context, listen: false));
        },
        child: allEmpty
            ? ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                children: const [
                  SizedBox(height: 160),
                  Icon(Icons.smart_toy_outlined, size: 64, color: Colors.grey),
                  SizedBox(height: 16),
                  Center(child: Text('実行中のタスクはありません')),
                ],
              )
            : ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                // 下端は FAB が最後のカードの停止・再開ボタンに重ならない分を空ける
                padding: const EdgeInsets.fromLTRB(8, 8, 8, 88),
                children: [
                  const _SectionTitle('実行中'),
                  ..._buildSection<ExecutingTask>(
                    state: executingAsync,
                    items: executing,
                    emptyText: '実行中のタスクはありません',
                    errorText: '実行中のタスクを取得できませんでした',
                    onRetry: () => ref.invalidate(executingTasksProvider),
                    itemBuilder: (task) =>
                        _buildExecutingTile(context, ref, task, titles),
                  ),
                  const SizedBox(height: 16),
                  const _SectionTitle('再開可能'),
                  ..._buildSection<ResumableExecution>(
                    state: resumableAsync,
                    items: resumable,
                    emptyText: '再開できる実行はありません',
                    errorText: '再開可能な実行を取得できませんでした',
                    onRetry: () => ref.invalidate(resumableExecutionsProvider),
                    itemBuilder: (execution) =>
                        _buildResumableTile(context, ref, execution, titles),
                  ),
                ],
              ),
      ),
    );
  }

  List<Widget> _buildSection<T>({
    required AsyncValue<Object?> state,
    required List<T>? items,
    required String emptyText,
    required String errorText,
    required VoidCallback onRetry,
    required Widget Function(T item) itemBuilder,
  }) {
    if (state.hasError) {
      return [_SectionError(message: errorText, onRetry: onRetry)];
    }
    if (items == null) {
      return const [
        Padding(
          padding: EdgeInsets.all(24),
          child: Center(child: CircularProgressIndicator()),
        ),
      ];
    }
    if (items.isEmpty) {
      return [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Center(child: Text(emptyText)),
          ),
        ),
      ];
    }
    return items.map(itemBuilder).toList();
  }

  Widget _buildExecutingTile(
    BuildContext context,
    WidgetRef ref,
    ExecutingTask task,
    Map<String, String> titles,
  ) {
    final title = taskTitleOrFallback(titles, task.taskId);
    final elapsed = _elapsedText(task);
    return Card(
      child: ListTile(
        leading: task.isWaitingForInput
            ? const Icon(Icons.help_outline, color: Colors.orange)
            : const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Row(
          children: [
            StatusBadge.execution(status: task.executionStatus),
            if (task.isWaitingForInput) ...[
              const SizedBox(width: 8),
              Flexible(
                child: Text(
                  'エージェントが回答を待っています',
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: Colors.orange),
                  overflow: TextOverflow.ellipsis,
                ),
              ),
            ] else if (elapsed != null) ...[
              const SizedBox(width: 8),
              Text(elapsed, style: Theme.of(context).textTheme.bodySmall),
            ],
          ],
        ),
        trailing: IconButton(
          icon: const Icon(Icons.stop, color: Colors.red),
          tooltip: '停止',
          onPressed: () => _stopExecution(context, ref, task.taskId, title),
        ),
        onTap: () => _showLogs(
          context,
          title: title,
          taskId: task.taskId,
          executionId: task.executionId,
        ),
      ),
    );
  }

  Widget _buildResumableTile(
    BuildContext context,
    WidgetRef ref,
    ResumableExecution execution,
    Map<String, String> titles,
  ) {
    final title = execution.taskTitle ??
        taskTitleOrFallback(titles, execution.taskId);
    final error = execution.errorMessage;
    final taskId = execution.taskId;
    return Card(
      child: ListTile(
        leading: const Icon(Icons.pause_circle, color: Colors.amber),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: error != null && error.isNotEmpty
            ? Text(
                error,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: Theme.of(context)
                    .textTheme
                    .bodySmall
                    ?.copyWith(color: Colors.red),
              )
            : const Text('中断'),
        trailing: TextButton.icon(
          icon: const Icon(Icons.play_arrow),
          label: const Text('再開'),
          onPressed: () =>
              _resumeExecution(context, execution.id, taskId: taskId),
        ),
        onTap: taskId == null
            ? null
            : () => _showLogs(
                  context,
                  title: title,
                  taskId: taskId,
                  executionId: execution.id,
                ),
      ),
    );
  }

  /// 経過時間 = それまでのフェーズの累計（activeTimeMs）+ 現在の実行の経過
  String? _elapsedText(ExecutingTask task) {
    final startedAt = task.startedAt;
    if (startedAt == null && task.activeTimeMs == 0) return null;
    var ms = task.activeTimeMs;
    if (startedAt != null) {
      final live = DateTime.now().difference(startedAt).inMilliseconds;
      if (live > 0) ms += live;
    }
    final minutes = ms ~/ 60000;
    if (minutes < 1) return '1分未満';
    if (minutes < 60) return '$minutes分経過';
    return '${minutes ~/ 60}時間${minutes % 60}分経過';
  }

  /// 実行の状態が変わる操作の後に読み直すもの。
  ///
  /// API の await 中に画面が破棄されると WidgetRef は使えなくなるが、
  /// サーバー側の状態は変わっているのでキャッシュの読み直し自体は必要。
  /// そのため await の前に控えた ProviderContainer から invalidate する。
  static void _invalidateExecutions(ProviderContainer container) {
    container.invalidate(executingTasksProvider);
    container.invalidate(resumableExecutionsProvider);
    container.invalidate(taskExecutionLogsProvider);
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
      final isSimpleExecute =
          RegExp(r'^(?:実行|自動実行|エージェント実行)(?:して|する)?$').hasMatch(query.trim());
      if (isSimpleExecute) {
        tasks = await taskService.getTasks(status: 'todo');
      } else {
        tasks = await taskService.searchTasks(query);
        if (tasks.isEmpty) {
          tasks = await taskService.getTasks(status: 'todo');
        }
      }

      final executableTasks =
          tasks.where((t) => t.agentExecutable || t.isDeveloperMode).toList();

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
                  title: Text(task.title,
                      maxLines: 2, overflow: TextOverflow.ellipsis),
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
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('キャンセル')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('実行')),
          ],
        ),
      );

      if (confirmed != true || !context.mounted) return;

      final container = ProviderScope.containerOf(context, listen: false);
      final result =
          await container.read(agentServiceProvider).executeTask(selected.id);
      _invalidateExecutions(container);
      // 実行開始（または質問作成）でタスクのステータスも変わる
      container.invalidate(taskListProvider);
      container.invalidate(taskDetailProvider(selected.id));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(result.isAwaitingQuestion
              ? (result.message ?? '「${selected.title}」の仕様確認の質問を作成しました')
              : '「${selected.title}」の実行を開始しました'),
        ),
      );
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('実行に失敗しました: $e')),
        );
      }
    }
  }

  Future<void> _stopExecution(
    BuildContext context,
    WidgetRef ref,
    String taskId,
    String title,
  ) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('実行を停止'),
        content: Text('「$title」の実行を停止しますか？'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('いいえ')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('停止')),
        ],
      ),
    );

    // ダイアログ表示中に画面が破棄されていたら ref は使えない
    if (confirmed != true || !context.mounted) return;
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(agentServiceProvider).stopTaskExecution(taskId);
      _invalidateExecutions(container);
      // 停止でタスクのステータスも戻るので一覧も読み直す
      container.invalidate(taskListProvider);
      container.invalidate(taskDetailProvider(taskId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('実行を停止しました')),
      );
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('停止に失敗しました: $e')),
        );
      }
    }
  }

  Future<void> _resumeExecution(
    BuildContext context,
    String executionId, {
    required String? taskId,
  }) async {
    final container = ProviderScope.containerOf(context, listen: false);
    try {
      await container.read(agentServiceProvider).resumeExecution(executionId);
      _invalidateExecutions(container);
      container.invalidate(taskListProvider);
      // タスクが外れた実行（taskId なし）は詳細キャッシュが無いのでスキップ
      if (taskId != null) container.invalidate(taskDetailProvider(taskId));
      if (!context.mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('実行を再開しました')),
      );
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('再開に失敗しました: $e')),
        );
      }
    }
  }

  void _showLogs(
    BuildContext context, {
    required String title,
    required String taskId,
    required String executionId,
  }) {
    final key = (taskId: taskId, executionId: executionId);
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
                final logsAsync = ref.watch(taskExecutionLogsProvider(key));
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.all(16),
                      child: Row(
                        children: [
                          Expanded(
                            child: Text(
                              '実行ログ：$title',
                              style: Theme.of(context).textTheme.titleMedium,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                          ),
                          IconButton(
                            icon: const Icon(Icons.refresh),
                            tooltip: '再読み込み',
                            onPressed: () =>
                                ref.invalidate(taskExecutionLogsProvider(key)),
                          ),
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
                        loading: () =>
                            const Center(child: CircularProgressIndicator()),
                        error: (e, _) =>
                            Center(child: Text('ログの取得に失敗しました: $e')),
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

class _SectionTitle extends StatelessWidget {
  final String title;

  const _SectionTitle(this.title);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 8, 8, 4),
      child: Text(
        title,
        style: Theme.of(context)
            .textTheme
            .titleMedium
            ?.copyWith(fontWeight: FontWeight.bold),
      ),
    );
  }
}

/// セクション単位の取得失敗表示。もう片方のセクションはそのまま出す。
class _SectionError extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _SectionError({required this.message, required this.onRetry});

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
            Expanded(child: Text(message)),
            TextButton(onPressed: onRetry, child: const Text('再試行')),
          ],
        ),
      ),
    );
  }
}
