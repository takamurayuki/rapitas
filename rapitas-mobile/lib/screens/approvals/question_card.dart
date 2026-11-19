import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../models/task_execution.dart';
import '../../providers/execution_provider.dart';
import '../../providers/service_providers.dart';
import '../../utils/date_formatter.dart';
import 'pending_questions.dart';

// 入力待ちの実行1件のカード。質問文（無ければ「入力待ちです」）と回答欄。
// 送信は POST /tasks/:id/agent-respond。成功したら一覧から外し、
// 失敗したら入力を残したままカード内にエラーを出す（成功と見せかけない）。

class QuestionCard extends ConsumerStatefulWidget {
  final ExecutingTask task;
  final String taskTitle;

  const QuestionCard({super.key, required this.task, required this.taskTitle});

  @override
  ConsumerState<QuestionCard> createState() => _QuestionCardState();
}

class _QuestionCardState extends ConsumerState<QuestionCard> {
  final _controller = TextEditingController();
  bool _sending = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _controller.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  bool get _canSend => !_sending && _controller.text.trim().isNotEmpty;

  Future<void> _send() async {
    final task = widget.task;
    // 送信成功でこのカードは消えるので、SnackBar の出し先は先に押さえておく
    final messenger = ScaffoldMessenger.of(context);
    setState(() {
      _sending = true;
      _error = null;
    });
    try {
      await ref.read(agentServiceProvider).respondToAgent(task.taskId, _controller.text);
    } catch (e) {
      if (mounted) {
        setState(() {
          _sending = false;
          _error = '送信に失敗しました: $e';
        });
      }
      return;
    }
    final answered = ref.read(answeredQuestionsProvider.notifier);
    answered.state = {...answered.state, answeredKeyOf(task): ref.read(answeredClockProvider)()};
    ref.invalidate(executingTasksProvider);
    messenger.showSnackBar(SnackBar(content: Text('「${widget.taskTitle}」に回答を送りました')));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final scheme = theme.colorScheme;
    final task = widget.task;
    final id = task.executionId;
    final since = task.startedAt ?? task.sessionStartedAt;
    final muted = theme.textTheme.bodySmall?.copyWith(color: scheme.onSurface.withValues(alpha: 0.6));

    return Card(
      key: ValueKey('question-card-$id'),
      // 承認カードと見分けるため、地の色・枠・左上のアイコンで「質問」を示す
      color: scheme.tertiaryContainer.withValues(alpha: 0.35),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: scheme.tertiary.withValues(alpha: 0.6)),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.question_answer_outlined, size: 18, color: scheme.tertiary),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    widget.taskTitle,
                    style: theme.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w600),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (task.question != null)
              Text(task.question!, style: theme.textTheme.bodyMedium)
            else
              Text('入力待ちです', style: theme.textTheme.bodyMedium?.copyWith(color: scheme.onSurface.withValues(alpha: 0.7))),
            if (since != null) ...[
              const SizedBox(height: 6),
              Text('実行開始 ${DateFormatter.formatRelative(since)}', style: muted),
            ],
            const SizedBox(height: 12),
            TextField(
              key: ValueKey('question-input-$id'),
              controller: _controller,
              enabled: !_sending,
              minLines: 1,
              maxLines: 5,
              textInputAction: TextInputAction.newline,
              decoration: InputDecoration(
                hintText: task.question != null ? '回答を入力' : '指示や回答を入力',
                border: const OutlineInputBorder(),
                isDense: true,
                errorText: _error,
                errorMaxLines: 3,
              ),
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                key: ValueKey('question-send-$id'),
                onPressed: _canSend ? _send : null,
                icon: _sending
                    ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Icon(Icons.send, size: 18),
                label: const Text('送信'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
