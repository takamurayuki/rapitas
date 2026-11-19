/// 承認ページ（nav80）の回答済みの隠し方の期限。期限に達して再取得を始めてから、
/// その応答が届くまでの途中状態でも回答済みの行を出さないことを確かめる。
///
/// NOTE: 時計（answeredClockProvider）とテストのタイマーを同じ経過で進める。片方だけ進めると、
/// 期限のタイマーが発火しない・期限前に読み直してしまうなど、実機で起きない経路を見てしまう。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/screens/approvals/pending_questions.dart';

import '../support/approvals_fakes.dart';

Finder _card(String id) => find.byKey(ValueKey('question-card-$id'));
Finder _send(String id) => find.byKey(ValueKey('question-send-$id'));

ExecutingTask _runningRow(String executionId, String taskId) => ExecutingTask(
      executionId: executionId,
      sessionId: 's$executionId',
      taskId: taskId,
      executionStatus: 'running',
    );

/// 回答を送り終えたところまで進め、時計とタイマーを同じだけ進める関数を返す。
Future<Future<void> Function(Duration)> _answered(WidgetTester tester, CountingSource<ExecutingTask> source) async {
  var now = DateTime(2026, 11, 19, 10);
  await pumpApprovals(tester, executingSource: source, clock: () => now);
  await tester.enterText(find.byKey(const ValueKey('question-input-90')), '回答1');
  await tester.pump();
  await tester.tap(_send('90'));
  await tester.pumpAndSettle();
  expect(_card('90'), findsNothing, reason: '回答の直後は、まだ入力待ちが返っても隠す');
  return (Duration d) async {
    now = now.add(d);
    await tester.pump(d);
  };
}

/// 期限の直前まで隠れたままで、期限に達すると再取得を始め、応答待ちの間も隠れたままであること。
Future<void> _expectHiddenUntilResponse(
  WidgetTester tester,
  CountingSource<ExecutingTask> source,
  Future<void> Function(Duration) elapse,
) async {
  final fetchesBefore = source.fetches;
  source.gate = Completer<void>();

  await elapse(answeredHideWindow - const Duration(seconds: 1));
  expect(_card('90'), findsNothing, reason: '30秒の直前は隠したまま');
  expect(source.fetches, fetchesBefore, reason: '期限前には読み直さない');

  await elapse(const Duration(seconds: 1));
  await tester.pump();
  expect(source.fetches, fetchesBefore + 1, reason: '期限に達したら読み直す');
  expect(_card('90'), findsNothing, reason: '応答待ちの間は、直前の古い行を出さない');
  expect(_send('90'), findsNothing, reason: '古い待ちへ再送できる状態にしない');
  expect(approvalsContainer(tester).read(answeredQuestionsProvider), isNotEmpty,
      reason: '応答待ちの古い一覧で記録を消さない');

  // 応答を待ったまま時間が経っても、古い行は出さない
  await elapse(const Duration(seconds: 5));
  expect(_card('90'), findsNothing);
  // NOTE: 応答待ちの間も一覧は直前の成功値を持つ（AsyncData で isLoading）。それを期限前の
  // 古い成功と取り違えると、進行中の取得を捨てて読み直してしまう。ゲートを開く直前に数える
  expect(source.fetches, fetchesBefore + 1, reason: '応答待ちの間に同じ一覧を読み直さない');
}

void main() {
  for (final question in ['同じ質問', null]) {
    group('期限後の再取得（質問文: ${question ?? 'なし'}）', () {
      testWidgets('応答がまだ同じ入力待ちなら、新しい待ちとして出す', (tester) async {
        final source = CountingSource<ExecutingTask>([waitingRow('90', '900', question: question)]);
        final elapse = await _answered(tester, source);
        await _expectHiddenUntilResponse(tester, source, elapse);

        source.gate!.complete();
        await tester.pumpAndSettle();
        expect(_card('90'), findsOneWidget);
        expect(find.text('回答1'), findsNothing, reason: '新しい待ちの回答欄は空');
        expect(approvalsContainer(tester).read(answeredQuestionsProvider), isEmpty);
      });

      testWidgets('応答が running なら出さない', (tester) async {
        final source = CountingSource<ExecutingTask>([waitingRow('90', '900', question: question)]);
        final elapse = await _answered(tester, source);
        await _expectHiddenUntilResponse(tester, source, elapse);

        source.next = [_runningRow('90', '900')];
        source.gate!.complete();
        await tester.pumpAndSettle();
        expect(_card('90'), findsNothing);
        expect(approvalsContainer(tester).read(answeredQuestionsProvider), isEmpty);
      });
    });
  }

  testWidgets('期限後の再取得に失敗したら、エラーを出して古い行は隠したまま', (tester) async {
    final source = CountingSource<ExecutingTask>([waitingRow('90', '900', question: 'Q')]);
    final elapse = await _answered(tester, source);
    await _expectHiddenUntilResponse(tester, source, elapse);

    source.failFrom = source.fetches;
    source.gate!.complete();
    await tester.pumpAndSettle();
    expect(find.text('質問の取得に失敗しました'), findsOneWidget);
    expect(_card('90'), findsNothing);
    expect(approvalsContainer(tester).read(answeredQuestionsProvider), isNotEmpty);

    // 再試行が成功し、まだ同じ入力待ちなら新しい待ちとして出す
    source.failFrom = null;
    source.gate = null;
    await tester.tap(find.text('再試行'));
    await tester.pumpAndSettle();
    expect(find.text('質問の取得に失敗しました'), findsNothing);
    expect(_card('90'), findsOneWidget);
    expect(approvalsContainer(tester).read(answeredQuestionsProvider), isEmpty);
  });
}
