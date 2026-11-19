/// 承認ページの質問一覧の単体テスト（回答済みの隠し方と、その解除）。
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/approvals/pending_questions.dart';

ExecutingTask _row(String id, String status, {String? question, DateTime? startedAt}) => ExecutingTask(
      executionId: id,
      sessionId: 's$id',
      taskId: 't$id',
      executionStatus: status,
      question: question,
      startedAt: startedAt,
    );

void main() {
  group('pruneAnswered', () {
    test('まだ同じ質問で入力待ちなら残す（継続の開始前に再取得した場合）', () {
      final rows = [_row('1', 'waiting_for_input', question: 'Q')];
      final answered = {answeredKeyOf(rows.first)};
      expect(pruneAnswered(answered, rows), same(answered));
    });

    test('running に変わった・一覧から消えた待ちは外す（次の待ちを隠さない）', () {
      final answered = {'1|Q', '2|'};
      expect(pruneAnswered(answered, [_row('1', 'running')]), isEmpty);
    });

    test('同じ実行が別の質問を出したら、それは隠さない', () {
      final container = ProviderContainer(overrides: [
        executingTasksProvider.overrideWith((ref) async => [_row('1', 'waiting_for_input', question: '次の質問')]),
      ]);
      addTearDown(container.dispose);
      container.read(answeredQuestionsProvider.notifier).state = {'1|前の質問'};
      return container.read(executingTasksProvider.future).then((_) {
        final pending = container.read(pendingQuestionsProvider).value!;
        expect(pending.single.question, '次の質問');
      });
    });
  });

  test('質問は来た順（startedAt の古いもの）から、時刻の無いものは後ろ', () async {
    final t0 = DateTime(2026, 11, 20, 9);
    final container = ProviderContainer(overrides: [
      executingTasksProvider.overrideWith((ref) async => [
            _row('3', 'waiting_for_input'),
            _row('2', 'waiting_for_input', startedAt: t0.add(const Duration(minutes: 5))),
            _row('1', 'waiting_for_input', startedAt: t0),
            _row('4', 'running', startedAt: t0),
          ]),
    ]);
    addTearDown(container.dispose);
    await container.read(executingTasksProvider.future);
    final ids = container.read(pendingQuestionsProvider).value!.map((r) => r.executionId);
    expect(ids, ['1', '2', '3']);
  });
}
