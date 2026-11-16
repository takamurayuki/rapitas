import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task.dart';
import '../../providers/execution_provider.dart';
import '../../providers/service_providers.dart';
import '../../providers/task_provider.dart';

/// タスク詳細の実行状態ポーリング間隔。null なら回さない（テストで上書きする）。
final taskExecutionPollIntervalProvider =
    Provider<Duration?>((ref) => const Duration(seconds: 10));

/// このタスクが実行中（running / waiting_for_input）か。
/// 一覧の読み込み中・失敗時は直前の値（無ければ未実行）として扱う。
bool watchTaskExecuting(WidgetRef ref, String taskId) {
  final executing = ref.watch(executingTasksProvider).valueOrNull;
  return executing?.any((e) => e.taskId == taskId) ?? false;
}

/// 実行中のあいだだけ、実行状態と詳細を一定間隔で読み直す。
/// 実行が終わればタイマーを止め（ヘッダーのボタンが実行に戻る）、画面破棄でも止める。
class TaskExecutionPoller extends ConsumerStatefulWidget {
  final String taskId;
  final bool active;
  final Widget child;

  const TaskExecutionPoller({
    super.key,
    required this.taskId,
    required this.active,
    required this.child,
  });

  @override
  ConsumerState<TaskExecutionPoller> createState() => _TaskExecutionPollerState();
}

class _TaskExecutionPollerState extends ConsumerState<TaskExecutionPoller> {
  Timer? _timer;

  @override
  void initState() {
    super.initState();
    _sync();
  }

  @override
  void didUpdateWidget(TaskExecutionPoller oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.active != widget.active || oldWidget.taskId != widget.taskId) {
      _sync();
    }
  }

  void _sync() {
    _timer?.cancel();
    _timer = null;
    final interval = ref.read(taskExecutionPollIntervalProvider);
    if (!widget.active || interval == null) return;
    _timer = Timer.periodic(interval, (_) {
      if (!mounted) return;
      ref.invalidate(executingTasksProvider);
      ref.invalidate(taskDetailProvider(widget.taskId));
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => widget.child;
}

/// AppBar 直下の細い実行中表示（実行中のみ）。
PreferredSizeWidget? taskExecutingBar(bool executing) {
  if (!executing) return null;
  return const PreferredSize(
    preferredSize: Size.fromHeight(2),
    child: LinearProgressIndicator(
      key: ValueKey('task-detail-executing-bar'),
      minHeight: 2,
    ),
  );
}

/// ヘッダー固定の実行／停止ボタン。実行中なら canExecuteWithAgent によらず停止を出す。
/// どちらも出せないときは null（AppBar に何も置かない）。
Widget? taskExecutionHeaderButton(
  BuildContext context, {
  required Task task,
  required bool executing,
}) {
  if (executing) {
    return IconButton(
      key: const ValueKey('task-detail-stop'),
      icon: Icon(Icons.stop_circle, color: Theme.of(context).colorScheme.error),
      tooltip: '実行を停止',
      onPressed: () => stopTaskWithAgent(context, task),
    );
  }
  if (!task.canExecuteWithAgent) return null;
  return IconButton(
    key: const ValueKey('task-detail-execute'),
    icon: const Icon(Icons.play_circle),
    tooltip: 'AIエージェントで実行',
    onPressed: () => executeTaskWithAgent(context, task.id),
  );
}

/// 下部の実行情報カード（実行指示の表示用。操作はヘッダーに集約）。
class TaskExecutionInfoCard extends StatelessWidget {
  final Task task;
  final bool executing;

  const TaskExecutionInfoCard({super.key, required this.task, required this.executing});

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Card(
      key: const ValueKey('task-detail-execution-card'),
      // NOTE: 半透明の色だと Card の影が透けて灰色に見えるため、面の色に重ねた不透明色にする
      color: Color.alphaBlend(scheme.primaryContainer.withValues(alpha: 0.3), scheme.surface),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.play_circle, color: scheme.primary),
                const SizedBox(width: 8),
                Text(
                  executing ? 'AI実行中' : 'AI実行可能',
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
          ],
        ),
      ),
    );
  }
}

Future<void> executeTaskWithAgent(BuildContext context, String taskId) async {
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

  // ダイアログ表示中に画面が破棄されていたら context は使えない
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

/// 実行画面の停止と同じ流れ（確認→停止→読み直し→スナックバー）。
Future<void> stopTaskWithAgent(BuildContext context, Task task) async {
  final confirmed = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: const Text('実行を停止'),
      content: Text('「${task.title}」の実行を停止しますか？'),
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

  if (confirmed != true || !context.mounted) return;
  final container = ProviderScope.containerOf(context, listen: false);
  try {
    await container.read(agentServiceProvider).stopTaskExecution(task.id);
    container.invalidate(executingTasksProvider);
    container.invalidate(resumableExecutionsProvider);
    container.invalidate(taskExecutionLogsProvider);
    // 停止でタスクのステータスも戻るので詳細と一覧も読み直す
    container.invalidate(taskDetailProvider(task.id));
    container.invalidate(taskListProvider);
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('実行を停止しました')),
    );
  } catch (e) {
    if (!context.mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text('停止に失敗しました: $e')),
    );
  }
}
