import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../models/companion_digest.dart';
import '../../models/task.dart';
import '../../providers/companion_provider.dart';
import '../../providers/task_provider.dart';
import '../../utils/plain_reasons.dart';
import '../../widgets/task_companion_sections.dart' show workflowStageInfo;
import 'decision_sections.dart';

/// 判断画面（/tasks/:id/decide、ラピ伴走化 第2段階-4）。
///
/// いまのタスクの列（workflowStatus・haltReason）から「あなたが決めること」を決め、その操作だけを出す。
/// 送信はラピを通さず、この画面からバックエンドの人間専用ルートへ直接届く（設計 2章・8章）。
/// ラピの要約・タスク詳細の「判断する」から開く。
class TaskDecisionScreen extends ConsumerWidget {
  final String taskId;

  const TaskDecisionScreen({super.key, required this.taskId});

  void _done(BuildContext context, WidgetRef ref, String message) {
    ref.invalidate(taskDetailProvider(taskId));
    ref.invalidate(taskListProvider);
    ref.read(companionDigestProvider.notifier).load();
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    if (context.canPop()) context.pop();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final taskAsync = ref.watch(taskDetailProvider(taskId));
    return Scaffold(
      appBar: AppBar(title: const Text('判断')),
      body: taskAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (_, __) => Center(
          child: TextButton(
            onPressed: () => ref.invalidate(taskDetailProvider(taskId)),
            child: const Text('読み込めませんでした。もう一度読む'),
          ),
        ),
        data: (task) => _body(context, ref, task),
      ),
    );
  }

  Widget _body(BuildContext context, WidgetRef ref, Task task) {
    final theme = Theme.of(context);
    final kind = decisionKindFor(
        status: task.status, workflowStatus: task.workflowStatus, haltReason: task.haltReason);
    void onDone(String message) => _done(context, ref, message);

    final Widget section = switch (kind) {
      'approve_plan' => PlanDecisionSection(taskId: taskId, onDone: onDone),
      'answer_question' => QuestionDecisionSection(taskId: taskId, onDone: onDone),
      'review_hold' => HoldDecisionSection(taskId: taskId, onDone: onDone),
      'release_halt' =>
        HaltDecisionSection(taskId: taskId, haltReason: task.haltReason!, onDone: onDone),
      _ => Text(
          'いまあなたが決めることはありません（いまの段階：${workflowStageInfo(task.workflowStatus).label}）。',
          key: const ValueKey('decision-none'),
          style: theme.textTheme.bodyMedium,
        ),
    };

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        InkWell(
          onTap: () => context.push('/tasks/$taskId'),
          child: Text(task.title,
              style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.bold)),
        ),
        const SizedBox(height: 12),
        if (kind != null) ...[
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.colorScheme.secondaryContainer,
              borderRadius: BorderRadius.circular(10),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('あなたが決めること：${decisionCopy(kind).title}',
                    style: theme.textTheme.labelLarge?.copyWith(
                        color: theme.colorScheme.onSecondaryContainer,
                        fontWeight: FontWeight.w600)),
                const SizedBox(height: 4),
                Text(decisionCopy(kind).ask,
                    style: theme.textTheme.bodyMedium
                        ?.copyWith(color: theme.colorScheme.onSecondaryContainer)),
              ],
            ),
          ),
          const SizedBox(height: 20),
        ],
        section,
        const SizedBox(height: 24),
      ],
    );
  }
}
