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

    test('回答より前に始めた取得の結果では外さない', () {
      final answered = {'1|Q': t0};
      expect(pruneAnswered(answered, [_row('1', 'running')], t0.subtract(const Duration(seconds: 1))), same(answered));
    });

    test('期限より後に始めた取得なら、まだ同じ入力待ちが返っていても外す', () {
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
      test('期限を過ぎても、期限より後に始めた取得が成功するまでは隠す（質問文: ${question ?? 'なし'}）', () async {
        var now = t0;
        final row = _row('1', 'waiting_for_input', question: question);
        final container = containerWith([row], () => now);
        container.read(answeredQuestionsProvider.notifier).state = {answeredKeyOf(row): t0};
        await container.read(executingTasksProvider.future);
        expect(container.read(pendingQuestionsProvider).value, isEmpty, reason: '回答の直後は隠す');

        now = t0.add(answeredHideWindow);
        container.invalidate(pendingQuestionsProvider);
        expect(container.read(pendingQuestionsProvider).value, isEmpty,
            reason: '手元の一覧は期限前に始めた取得の結果なので、まだ出さない');

        container.invalidate(executingTasksProvider);
        expect(container.read(pendingQuestionsProvider).value, isEmpty, reason: '再取得中も隠す');
        await container.read(executingTasksProvider.future);
        expect(container.read(pendingQuestionsProvider).value!.single.executionId, '1',
            reason: '期限より後に始めた取得がまだ入力待ちなら、新しい待ちとして出す');
      });
    }

    test('期限前の古い成功のまま期限を過ぎたら、自分で読み直す', () async {
      var now = t0;
      var fetches = 0;
      final row = _row('1', 'waiting_for_input', question: 'Q');
      final container = ProviderContainer(overrides: [
        executingTasksProvider.overrideWith((ref) async {
          fetches++;
          return [row];
        }),
        answeredClockProvider.overrideWithValue(() => now),
      ]);
      addTearDown(container.dispose);
      final sub = container.listen(pendingQuestionsProvider, (_, __) {});
      addTearDown(sub.close);
      container.read(answeredQuestionsProvider.notifier).state = {answeredKeyOf(row): t0};
      await container.read(executingTasksProvider.future);
      final before = fetches;

      // 期限のタイマーを逃した状態（時計だけが進み、何かのきっかけで組み直された）
      now = t0.add(answeredHideWindow);
      container.invalidate(pendingQuestionsProvider);
      expect(sub.read().value, isEmpty);
      await Future<void>.delayed(Duration.zero);
      await container.read(executingTasksProvider.future);
      expect(fetches, before + 1);
      expect(sub.read().value!.single.executionId, '1');
    });
  });

  group('executingTasksSnapshotProvider', () {
    test('再取得中・失敗時は新鮮な一覧を返さない（直前の値が残っていても）', () async {
      var fail = false;
      final container = ProviderContainer(overrides: [
        executingTasksProvider.overrideWith((ref) async {
          if (fail) throw Exception('network');
          return [_row('1', 'waiting_for_input')];
        }),
        answeredClockProvider.overrideWithValue(() => t0),
      ]);
      addTearDown(container.dispose);
      final sub = container.listen(executingTasksSnapshotProvider, (_, __) {});
      addTearDown(sub.close);
      await container.read(executingTasksProvider.future);
      expect(sub.read().freshRows, hasLength(1));
      expect(sub.read().fetchStartedAt, t0);

      container.invalidate(executingTasksProvider);
      expect(sub.read().value.valueOrNull, hasLength(1), reason: 'Riverpod は再取得中も直前の値を残す');
      expect(sub.read().freshRows, isNull);

      fail = true;
      container.invalidate(executingTasksProvider);
      await expectLater(container.read(executingTasksProvider.future), throwsException);
      expect(sub.read().value.valueOrNull, hasLength(1));
      expect(sub.read().freshRows, isNull);
    });
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
