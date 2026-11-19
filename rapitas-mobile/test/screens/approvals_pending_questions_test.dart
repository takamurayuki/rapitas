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
  final t0 = DateTime(2026, 11, 20, 9);

  ProviderContainer containerWith(List<ExecutingTask> rows, DateTime Function() clock) {
    final container = ProviderContainer(overrides: [
      executingTasksProvider.overrideWith((ref) async => rows),
      answeredClockProvider.overrideWithValue(clock),
    ]);
    addTearDown(container.dispose);
    return container;
  }

  group('pruneAnswered', () {
    test('まだ同じ質問で入力待ちなら残す（継続の開始前に再取得した場合）', () {
      final rows = [_row('1', 'waiting_for_input', question: 'Q')];
      final answered = {answeredKeyOf(rows.first): t0};
      expect(pruneAnswered(answered, rows, t0.add(const Duration(seconds: 5))), same(answered));
    });

    test('running に変わった・一覧から消えた待ちは外す（次の待ちを隠さない）', () {
      final answered = {'1|Q': t0, '2|': t0};
      expect(pruneAnswered(answered, [_row('1', 'running')], t0), isEmpty);
    });

    test('期限を過ぎた記録は、まだ同じ入力待ちが返っていても外す', () {
      final rows = [_row('1', 'waiting_for_input', question: 'Q'), _row('2', 'waiting_for_input')];
      final answered = {'1|Q': t0, '2|': t0.add(const Duration(seconds: 20))};
      expect(pruneAnswered(answered, rows, t0.add(answeredHideWindow)), {'2|': t0.add(const Duration(seconds: 20))});
    });
  });

  group('pendingQuestionsProvider の回答済みの隠し方', () {
    test('同じ実行が別の質問を出したら、それは隠さない', () async {
      final container = containerWith([_row('1', 'waiting_for_input', question: '次の質問')], () => t0);
      container.read(answeredQuestionsProvider.notifier).state = {'1|前の質問': t0};
      await container.read(executingTasksProvider.future);
      expect(container.read(pendingQuestionsProvider).value!.single.question, '次の質問');
    });

    test('実行IDが異なる待ちは、同じ文面でも隠さない', () async {
      final container = containerWith([
        _row('1', 'waiting_for_input', question: 'Q'),
        _row('2', 'waiting_for_input', question: 'Q'),
      ], () => t0);
      container.read(answeredQuestionsProvider.notifier).state = {'1|Q': t0};
      await container.read(executingTasksProvider.future);
      expect(container.read(pendingQuestionsProvider).value!.map((r) => r.executionId), ['2']);
    });

    // 同じ実行が同じ文面で再び入力待ちになり、途中の running を取得できなかった場合
    for (final question in ['同じ質問', null]) {
      test('回答済みの記録は期限までしか隠さない（質問文: ${question ?? 'なし'}）', () async {
        var now = t0;
        final row = _row('1', 'waiting_for_input', question: question);
        final container = containerWith([row], () => now);
        container.read(answeredQuestionsProvider.notifier).state = {answeredKeyOf(row): t0};
        await container.read(executingTasksProvider.future);
        expect(container.read(pendingQuestionsProvider).value, isEmpty, reason: '回答の直後は隠す');

        now = t0.add(answeredHideWindow);
        container.invalidate(pendingQuestionsProvider);
        expect(container.read(pendingQuestionsProvider).value!.single.executionId, '1',
            reason: '期限を過ぎたら新しい待ちとして出す');
      });
    }
  });

  test('質問は来た順（startedAt の古いもの）から、時刻の無いものは後ろ', () async {
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
