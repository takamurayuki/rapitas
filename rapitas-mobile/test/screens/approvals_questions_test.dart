/// 承認ページの「エージェントの質問」section（nav80）。
/// 入力待ち（waiting_for_input）の実行をカードで出し、その場で
/// POST /tasks/:id/agent-respond に回答できること、承認の既存の動きを壊さないことを確かめる。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/approval_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/approvals/approvals_screen.dart';
import 'package:rapitas_mobile/services/agent_service.dart';

import '../support/approvals_fakes.dart';

void main() {
  final now = DateTime.now();

  testWidgets('入力待ちの質問をタスク名・質問文・経過時刻つきで出す（来た順＝古いものから）', (tester) async {
    await pumpApprovals(tester, executing: [
      waitingRow('11', '101', question: '新しい質問です', startedAt: now.subtract(const Duration(minutes: 3))),
      waitingRow('10', '100', question: '古い質問です', startedAt: now.subtract(const Duration(minutes: 30))),
      const ExecutingTask(executionId: '12', sessionId: 's12', taskId: '102', executionStatus: 'running'),
    ], titles: {
      '100': 'ログイン画面',
      '101': '通知設定',
      '102': '実行中のタスク',
    });

    expect(find.text('エージェントの質問'), findsOneWidget);
    expect(find.text('ログイン画面'), findsOneWidget);
    expect(find.text('古い質問です'), findsOneWidget);
    expect(find.text('新しい質問です'), findsOneWidget);
    expect(find.textContaining('30分前'), findsOneWidget);
    // running の実行は質問ではない
    expect(find.text('実行中のタスク'), findsNothing);
    // 古いものが上
    final oldY = tester.getTopLeft(find.byKey(const ValueKey('question-card-10'))).dy;
    final newY = tester.getTopLeft(find.byKey(const ValueKey('question-card-11'))).dy;
    expect(oldY, lessThan(newY));
    // 承認が無いので承認の見出しは出さない
    expect(find.text('承認リクエスト'), findsNothing);
    expect(find.textContaining('ありません'), findsNothing);
  });

  testWidgets('質問文が無い待ちは「入力待ちです」と出し、自由文で回答できる', (tester) async {
    final agent = FakeAgent();
    await pumpApprovals(tester, agent: agent, executing: [waitingRow('20', '200')], titles: {'200': '設定画面'});

    expect(find.text('入力待ちです'), findsOneWidget);
    await tester.enterText(find.byKey(const ValueKey('question-input-20')), '続けてください');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('question-send-20')));
    await tester.pumpAndSettle();

    expect(agent.responded.single, (taskId: '200', response: '続けてください'));
  });

  testWidgets('タスク名が引けないときは「タスク #id」で出す', (tester) async {
    await pumpApprovals(tester, executing: [waitingRow('21', '201', question: 'Q')]);
    expect(find.text('タスク #201'), findsOneWidget);
  });

  testWidgets('空の回答は送れない（送信ボタンが押せない）', (tester) async {
    final agent = FakeAgent();
    await pumpApprovals(tester, agent: agent, executing: [waitingRow('30', '300', question: 'Q')]);

    FilledButton send() => tester.widget<FilledButton>(find.byKey(const ValueKey('question-send-30')));
    expect(send().onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('question-input-30')), '   ');
    await tester.pump();
    expect(send().onPressed, isNull);
    await tester.enterText(find.byKey(const ValueKey('question-input-30')), 'はい');
    await tester.pump();
    expect(send().onPressed, isNotNull);
    expect(agent.responded, isEmpty);
  });

  testWidgets('送信に成功するとカードが消える（再取得がまだ入力待ちを返しても）', (tester) async {
    final agent = FakeAgent();
    await pumpApprovals(tester, agent: agent, executing: [
      waitingRow('40', '400', question: '質問A', startedAt: now),
      waitingRow('41', '401', question: '質問B', startedAt: now),
    ]);

    await tester.enterText(find.byKey(const ValueKey('question-input-40')), 'Aで');

    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('question-send-40')));
    await tester.pumpAndSettle();

    expect(agent.responded.single, (taskId: '400', response: 'Aで'));
    expect(find.byKey(const ValueKey('question-card-40')), findsNothing);
    expect(find.text('質問A'), findsNothing);
    expect(find.byKey(const ValueKey('question-card-41')), findsOneWidget);
    expect(find.textContaining('に回答を送りました'), findsOneWidget);
  });

  testWidgets('最後の質問に回答して何も無くなったら空状態を出す', (tester) async {
    await pumpApprovals(tester, executing: [waitingRow('42', '402', question: '質問')]);

    await tester.enterText(find.byKey(const ValueKey('question-input-42')), 'OK');

    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('question-send-42')));
    await tester.pumpAndSettle();

    expect(find.text('承認リクエストも質問もありません'), findsOneWidget);
  });

  testWidgets('送信に失敗したら入力を保持してエラーを出し、再送できる', (tester) async {
    final agent = FakeAgent()..fail = const AgentActionException('Execution is not waiting for input: completed');
    await pumpApprovals(tester, agent: agent, executing: [waitingRow('50', '500', question: '質問')]);

    await tester.enterText(find.byKey(const ValueKey('question-input-50')), '回答の下書き');

    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('question-send-50')));
    await tester.pumpAndSettle();

    expect(find.byKey(const ValueKey('question-card-50')), findsOneWidget);
    expect(find.text('回答の下書き'), findsOneWidget);
    expect(find.textContaining('送信に失敗しました'), findsOneWidget);
    expect(find.textContaining('Execution is not waiting for input: completed'), findsOneWidget);
    expect(find.textContaining('回答を送りました'), findsNothing);

    agent.fail = null;
    await tester.tap(find.byKey(const ValueKey('question-send-50')));
    await tester.pumpAndSettle();

    expect(agent.responded.single, (taskId: '500', response: '回答の下書き'));
    expect(find.byKey(const ValueKey('question-card-50')), findsNothing);
  });

  testWidgets('送信中は二重に送れない', (tester) async {
    final agent = FakeAgent()..gate = Completer<void>();
    await pumpApprovals(tester, agent: agent, executing: [waitingRow('60', '600', question: '質問')]);

    await tester.enterText(find.byKey(const ValueKey('question-input-60')), '回答');

    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('question-send-60')));
    await tester.pump();
    expect(tester.widget<FilledButton>(find.byKey(const ValueKey('question-send-60'))).onPressed, isNull);

    agent.gate!.complete();
    await tester.pumpAndSettle();
    expect(agent.responded, hasLength(1));
  });

  testWidgets('承認も質問も無いときだけ「ありません」を出す', (tester) async {
    await pumpApprovals(tester);
    expect(find.text('承認リクエストも質問もありません'), findsOneWidget);
    expect(find.text('承認リクエスト'), findsNothing);
    expect(find.text('エージェントの質問'), findsNothing);
  });

  testWidgets('承認だけあるときは承認の section だけを出す', (tester) async {
    await pumpApprovals(tester, approvals: [pendingApproval('a1', 'デプロイの承認')]);
    expect(find.text('承認リクエスト'), findsOneWidget);
    expect(find.text('デプロイの承認'), findsOneWidget);
    expect(find.text('エージェントの質問'), findsNothing);
    expect(find.textContaining('ありません'), findsNothing);
  });

  testWidgets('承認と質問が両方あるときは承認が先（音声の番号付けの並びと一致）', (tester) async {
    final approvals = FakeApprovals();
    await pumpApprovals(
      tester,
      approvalService: approvals,
      approvals: [pendingApproval('a1', '承認その1'), pendingApproval('a2', '承認その2')],
      executing: [waitingRow('70', '700', question: '質問です')],
    );

    final approvalsY = tester.getTopLeft(find.text('承認リクエスト')).dy;
    final questionsY = tester.getTopLeft(find.text('エージェントの質問')).dy;
    expect(approvalsY, lessThan(questionsY));
    expect(tester.getTopLeft(find.text('承認その2')).dy, lessThan(questionsY));

    // 承認の既存の動き
    await tester.tap(find.widgetWithText(FilledButton, '承認').at(1));
    await tester.pumpAndSettle();
    expect(approvals.approved, ['a2']);
    expect(find.text('承認しました'), findsOneWidget);
  });

  testWidgets('質問の取得に失敗しても承認は出し、「ありません」とは言わない', (tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        approvalListProvider.overrideWith((ref) async => const []),
        executingTasksProvider.overrideWith((ref) async => throw Exception('network')),
        taskTitleLookupProvider.overrideWithValue(const {}),
      ],
      child: const MaterialApp(home: ApprovalsScreen()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('質問の取得に失敗しました'), findsOneWidget);
    expect(find.textContaining('ありません'), findsNothing);
  });
}
