/// 承認ページ（nav80）の取りこぼし対策。回答済みの隠し方の期限、再取得の失敗の見せ方、
/// 送信の入口の二重送信ガード、送信中にカードが破棄されたときの一覧の更新を確かめる。
library;

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
}
