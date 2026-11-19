/// 承認ページ（nav80）の取りこぼし対策。回答済みの隠し方の期限、再取得の失敗の見せ方、
/// 送信の入口の二重送信ガード、送信中にカードが破棄されたときの一覧の更新を確かめる。
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/approval_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/approvals/pending_questions.dart';

import '../support/approvals_fakes.dart';

Finder _card(String id) => find.byKey(ValueKey('question-card-$id'));

Future<void> _answer(WidgetTester tester, String id, String text) async {
  await tester.enterText(find.byKey(ValueKey('question-input-$id')), text);
  await tester.pump();
  await tester.tap(find.byKey(ValueKey('question-send-$id')));
}

void main() {
  group('回答済みの記録は新しい待ちを隠し続けない', () {
    // 同じ実行が同じ文面（または質問文なし）で再び入力待ちになり、途中の running を一度も
    // 取得できなかった場合。一覧は回答の前後でまったく同じ行を返し続ける。
    for (final question in ['同じ質問', null]) {
      testWidgets('期限を過ぎたら同じ行を新しい待ちとして出す（質問文: ${question ?? 'なし'}）', (tester) async {
        var now = DateTime(2026, 11, 19, 10);
        final source = CountingSource<ExecutingTask>([waitingRow('80', '800', question: question)]);
        await pumpApprovals(tester, executingSource: source, clock: () => now);

        await _answer(tester, '80', '回答1');
        await tester.pumpAndSettle();
        expect(_card('80'), findsNothing, reason: '回答の直後は、まだ入力待ちが返っても隠す');

        // 期限内の再取得では隠したまま
        now = now.add(const Duration(seconds: 10));
        approvalsContainer(tester).invalidate(executingTasksProvider);
        await tester.pumpAndSettle();
        expect(_card('80'), findsNothing);

        // 期限が来たら自分で読み直し、まだ入力待ちならそれは新しい待ち
        final fetchesBefore = source.fetches;
        now = now.add(answeredHideWindow);
        await tester.pump(answeredHideWindow);
        await tester.pumpAndSettle();
        expect(source.fetches, greaterThan(fetchesBefore));
        expect(_card('80'), findsOneWidget);
        expect(find.text('回答1'), findsNothing, reason: '新しい待ちの回答欄は空');
        expect(approvalsContainer(tester).read(answeredQuestionsProvider), isEmpty);
      });
    }

    testWidgets('送信に失敗した待ちは記録しない', (tester) async {
      final agent = FakeAgent()..fail = Exception('down');
      await pumpApprovals(tester, agent: agent, executing: [waitingRow('81', '801', question: 'Q')]);

      await _answer(tester, '81', '回答');
      await tester.pumpAndSettle();
      expect(approvalsContainer(tester).read(answeredQuestionsProvider), isEmpty);
      expect(_card('81'), findsOneWidget);
    });
  });

  group('再取得の失敗は空状態に見せない', () {
    testWidgets('質問の再取得に失敗したらエラーを出す（直前が空でも）', (tester) async {
      final source = CountingSource<ExecutingTask>([]);
      await pumpApprovals(tester, executingSource: source);
      expect(find.text('承認リクエストも質問もありません'), findsOneWidget);

      source.failFrom = 2;
      approvalsContainer(tester).invalidate(executingTasksProvider);
      await tester.pumpAndSettle();

      expect(find.text('質問の取得に失敗しました'), findsOneWidget);
      expect(find.textContaining('ありません'), findsNothing);
    });

    testWidgets('承認の再取得に失敗したらエラーを出す（直前が空でも）', (tester) async {
      final source = CountingSource<ApprovalRequest>([]);
      await pumpApprovals(tester, approvalSource: source);

      source.failFrom = 2;
      approvalsContainer(tester).invalidate(approvalListProvider);
      await tester.pumpAndSettle();

      expect(find.text('承認リクエストの取得に失敗しました'), findsOneWidget);
      expect(find.textContaining('ありません'), findsNothing);
    });

    testWidgets('直前に質問があっても、再取得の失敗はエラーとして出す', (tester) async {
      final source = CountingSource<ExecutingTask>([waitingRow('82', '802', question: '古い質問')]);
      await pumpApprovals(tester, executingSource: source);

      source.failFrom = 2;
      approvalsContainer(tester).invalidate(executingTasksProvider);
      await tester.pumpAndSettle();

      expect(find.text('質問の取得に失敗しました'), findsOneWidget);

      // 再試行で戻る
      source.failFrom = null;
      await tester.tap(find.text('再試行'));
      await tester.pumpAndSettle();
      expect(find.text('質問の取得に失敗しました'), findsNothing);
      expect(_card('82'), findsOneWidget);
    });
  });

  testWidgets('再描画の前に送信が続けて呼ばれても、POST は1回だけ', (tester) async {
    final agent = FakeAgent()..gate = Completer<void>();
    await pumpApprovals(tester, agent: agent, executing: [waitingRow('83', '803', question: 'Q')]);

    await tester.enterText(find.byKey(const ValueKey('question-input-83')), '回答');
    await tester.pump();
    final onPressed = tester.widget<FilledButton>(find.byKey(const ValueKey('question-send-83'))).onPressed!;
    onPressed();
    onPressed();

    agent.gate!.complete();
    await tester.pumpAndSettle();
    expect(agent.calls, 1);
    expect(agent.responded, hasLength(1));
  });

  group('送信中にカードが破棄されても一覧は更新する', () {
    testWidgets('承認：スクロールでカードが破棄された後に成功しても、承認の一覧を読み直す', (tester) async {
      final service = FakeApprovals()..gate = Completer<void>();
      final source = CountingSource<ApprovalRequest>([for (var i = 0; i < 30; i++) pendingApproval('a$i', '承認その$i')]);
      await pumpApprovals(tester, approvalSource: source, approvalService: service);

      await tester.tap(find.widgetWithText(FilledButton, '承認').first);
      await tester.pump();
      await tester.drag(find.byType(ListView), const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(find.text('承認その0', skipOffstage: false), findsNothing, reason: 'カードは破棄されている');

      final fetchesBefore = source.fetches;
      service.gate!.complete();
      await tester.pumpAndSettle();

      expect(service.approved, ['a0']);
      expect(source.fetches, greaterThan(fetchesBefore));
      expect(find.text('承認しました'), findsOneWidget);
    });

    testWidgets('却下：理由ダイアログの確定後にカードが破棄されてから成功しても、承認の一覧を読み直す', (tester) async {
      final service = FakeApprovals()..gate = Completer<void>();
      final source = CountingSource<ApprovalRequest>([for (var i = 0; i < 30; i++) pendingApproval('r$i', '却下その$i')]);
      await pumpApprovals(tester, approvalSource: source, approvalService: service);

      await tester.tap(find.widgetWithText(OutlinedButton, '却下').first);
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextField), '不要');
      await tester.tap(find.widgetWithText(FilledButton, '却下'));
      await tester.pumpAndSettle();
      await tester.drag(find.byType(ListView), const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(find.text('却下その0', skipOffstage: false), findsNothing, reason: 'カードは破棄されている');

      final fetchesBefore = source.fetches;
      service.gate!.complete();
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(service.rejected, ['r0']);
      expect(source.fetches, greaterThan(fetchesBefore));
      expect(find.text('却下しました'), findsOneWidget);
    });

    testWidgets('質問：スクロールでカードが破棄された後に成功しても、回答済みにして読み直す', (tester) async {
      final agent = FakeAgent()..gate = Completer<void>();
      final t0 = DateTime(2026, 11, 19, 9);
      final source = CountingSource<ExecutingTask>([
        for (var i = 0; i < 30; i++) waitingRow('${100 + i}', '${900 + i}', question: '質問$i', startedAt: t0.add(Duration(minutes: i))),
      ]);
      await pumpApprovals(tester, agent: agent, executingSource: source);

      await _answer(tester, '100', '回答');
      await tester.pump();
      // 入力欄にフォーカスがあると keep-alive でカードが残るので外す
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump();
      await tester.drag(find.byType(ListView), const Offset(0, -6000));
      await tester.pumpAndSettle();
      expect(_card('100').hitTestable(), findsNothing);
      expect(find.byKey(const ValueKey('question-card-100'), skipOffstage: false), findsNothing,
          reason: 'カードは破棄されている');

      final fetchesBefore = source.fetches;
      agent.gate!.complete();
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      expect(agent.responded.single.taskId, '900');
      expect(source.fetches, greaterThan(fetchesBefore));
      expect(find.textContaining('に回答を送りました'), findsOneWidget);

      await tester.drag(find.byType(ListView), const Offset(0, 6000));
      await tester.pumpAndSettle();
      expect(find.text('質問0'), findsNothing, reason: '回答済みとして一覧から外れている');
      expect(find.text('質問1'), findsOneWidget);
    });
  });
}
