import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/approval_request.dart';
import '../../models/task_execution.dart';
import '../../providers/approval_provider.dart';
import '../../providers/execution_provider.dart';
import '../../widgets/voice_scroll_target.dart';
import '../../widgets/app_drawer.dart';
import '../../widgets/voice_mode_indicator.dart';
import 'approval_card.dart';
import 'pending_questions.dart';
import 'question_card.dart';

// 承認ページ：承認リクエストと、エージェントの質問（入力待ちの実行）を section に分けて並べる。
//
// NOTE: 承認の section を必ず先に置く。音声の「2番目を承認」は承認リクエストの一覧
// （approvalListProvider の並び）だけで番号を数えるので（voice_command_flow.dart の
// _pickApproval）、承認を上に置けば画面の上からの並びと音声の番号が一致したままになる。
// 質問は音声の番号付けの対象にしない。

class ApprovalsScreen extends ConsumerWidget {
  const ApprovalsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // 回答済みとして隠した待ちを、バックエンドが入力待ちでなくした時点で外す
    ref.listen<AsyncValue<List<ExecutingTask>>>(executingTasksProvider, (_, next) {
      final rows = next.valueOrNull;
      if (rows == null) return;
      final notifier = ref.read(answeredQuestionsProvider.notifier);
      notifier.state = pruneAnswered(notifier.state, rows, ref.read(answeredClockProvider)());
    });
    final approvalsAsync = ref.watch(approvalListProvider);
    final questionsAsync = ref.watch(pendingQuestionsProvider);
    final titles = ref.watch(taskTitleLookupProvider);

    Future<void> reload() async {
      ref.invalidate(approvalListProvider);
      ref.invalidate(executingTasksProvider);
    }

    return Scaffold(
      drawer: const AppDrawer(),
      appBar: AppBar(
        // NOTE: 音声での承認・却下は音声操作モードから（聞き取り表示は右端。「2番目を承認」など）
        title: const Text('承認と質問'),
        actions: const [VoiceModeIndicator()],
      ),
      body: VoiceScrollTarget(
        path: '/approvals',
        child: RefreshIndicator(
          onRefresh: reload,
          child: _body(context, ref, approvalsAsync, questionsAsync, titles),
        ),
      ),
    );
  }

  Widget _body(
    BuildContext context,
    WidgetRef ref,
    AsyncValue<List<ApprovalRequest>> approvalsAsync,
    AsyncValue<List<ExecutingTask>> questionsAsync,
    Map<String, String> titles,
  ) {
    final approvals = approvalsAsync.valueOrNull ?? const <ApprovalRequest>[];
    final questions = questionsAsync.valueOrNull ?? const <ExecutingTask>[];
    final loading = approvalsAsync.isLoading && !approvalsAsync.hasValue ||
        questionsAsync.isLoading && !questionsAsync.hasValue;
    // NOTE: hasValue を条件に入れない。再取得の失敗は直前の値を保持した AsyncError になり、
    // hasValue が真のままになる。それを値として扱うと、直前が空なら「ありません」と見せてしまう。
    final children = <Widget>[
      if (approvalsAsync.hasError)
        _ErrorBlock(message: '承認リクエストの取得に失敗しました', onRetry: () => ref.invalidate(approvalListProvider))
      else if (approvals.isNotEmpty) ...[
        _SectionHeader(icon: Icons.fact_check_outlined, label: '承認リクエスト', count: approvals.length),
        for (final approval in approvals) ApprovalCard(approval: approval),
      ],
      if (questionsAsync.hasError)
        _ErrorBlock(message: '質問の取得に失敗しました', onRetry: () => ref.invalidate(executingTasksProvider))
      else if (questions.isNotEmpty) ...[
        _SectionHeader(icon: Icons.question_answer_outlined, label: 'エージェントの質問', count: questions.length),
        for (final task in questions)
          QuestionCard(
            key: ValueKey('question-${answeredKeyOf(task)}'),
            task: task,
            taskTitle: taskTitleOrFallback(titles, task.taskId),
          ),
      ],
    ];

    if (children.isEmpty) {
      // 片方でも読み込み中なら「ありません」とは言わない
      if (loading) return const Center(child: CircularProgressIndicator());
      return ListView(
        // 空でも「引っ張って更新」できるようにスクロール可能にしておく
        physics: const AlwaysScrollableScrollPhysics(),
        children: const [
          SizedBox(height: 160),
          Icon(Icons.fact_check, size: 64, color: Colors.grey),
          SizedBox(height: 16),
          Center(child: Text('承認リクエストも質問もありません')),
        ],
      );
    }
    return ListView(padding: const EdgeInsets.all(8), children: children);
  }
}

class _SectionHeader extends StatelessWidget {
  final IconData icon;
  final String label;
  final int count;

  const _SectionHeader({required this.icon, required this.label, required this.count});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Padding(
      padding: const EdgeInsets.fromLTRB(8, 12, 8, 4),
      child: Row(
        children: [
          Icon(icon, size: 18, color: theme.colorScheme.primary),
          const SizedBox(width: 6),
          Text(label, style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700)),
          const SizedBox(width: 6),
          Text('$count件', style: theme.textTheme.bodySmall),
        ],
      ),
    );
  }
}

class _ErrorBlock extends StatelessWidget {
  final String message;
  final VoidCallback onRetry;

  const _ErrorBlock({required this.message, required this.onRetry});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 24),
      child: Column(
        children: [
          const Icon(Icons.error_outline, size: 48, color: Colors.red),
          const SizedBox(height: 12),
          Text(message),
          const SizedBox(height: 8),
          ElevatedButton(onPressed: onRetry, child: const Text('再試行')),
        ],
      ),
    );
  }
}
