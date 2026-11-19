import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/approval_request.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/approval_provider.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/approvals/approvals_screen.dart';
import 'package:rapitas_mobile/screens/approvals/pending_questions.dart';
import 'package:rapitas_mobile/services/agent_service.dart';
import 'package:rapitas_mobile/services/approval_service.dart';

// 承認ページ（nav80）のテストで共有する差し替えと組み立て。

/// 回答の送信を記録する AgentService。[fail] が立っていれば例外を投げ、[gate] があれば完了まで待つ。
class FakeAgent implements AgentService {
  final List<({String taskId, String response})> responded = [];
  int calls = 0;
  Object? fail;
  Completer<void>? gate;

  @override
  Future<void> respondToAgent(String taskId, String response) async {
    calls++;
    if (gate != null) await gate!.future;
    if (fail != null) throw fail!;
    responded.add((taskId: taskId, response: response));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 承認・却下を記録する ApprovalService。[gate] があれば完了まで待つ。
class FakeApprovals implements ApprovalService {
  final List<String> approved = [];
  final List<String> rejected = [];
  Completer<void>? gate;

  @override
  Future<void> approve(String id) async {
    if (gate != null) await gate!.future;
    approved.add(id);
  }

  @override
  Future<void> reject(String id, {String? reason}) async {
    if (gate != null) await gate!.future;
    rejected.add(id);
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// 一覧の取得回数を数え、[next] で返す中身を差し替えられる取得元。
/// [failFrom] 回目以降の取得は失敗させる（1始まり。null なら失敗しない）。
/// [gate] があれば、その完了まで応答を返さない（応答待ちの途中状態を見るため）。
/// 返す中身と失敗の判定は応答の時点の [next] / [failFrom] で決める。
class CountingSource<T> {
  List<T> next;
  int fetches = 0;
  int? failFrom;
  Completer<void>? gate;

  CountingSource(this.next);

  Future<List<T>> fetch() async {
    final n = ++fetches;
    if (gate != null) await gate!.future;
    if (failFrom != null && n >= failFrom!) throw Exception('network');
    return next;
  }
}

ExecutingTask waitingRow(String executionId, String taskId, {String? question, DateTime? startedAt}) => ExecutingTask(
      executionId: executionId,
      sessionId: 's$executionId',
      taskId: taskId,
      executionStatus: 'waiting_for_input',
      startedAt: startedAt,
      question: question,
    );

ApprovalRequest pendingApproval(String id, String title) =>
    ApprovalRequest(id: id, title: title, status: 'pending', createdAt: DateTime.now());

/// [ApprovalsScreen] を組み立てる。一覧は [approvals] / [executing] が毎回同じ中身を返す
/// （送信成功後の再取得でもバックエンドがまだ入力待ちを返す、fire-and-forget の継続を再現する）。
Future<void> pumpApprovals(
  WidgetTester tester, {
  List<ApprovalRequest> approvals = const [],
  List<ExecutingTask> executing = const [],
  CountingSource<ApprovalRequest>? approvalSource,
  CountingSource<ExecutingTask>? executingSource,
  Map<String, String> titles = const {},
  FakeAgent? agent,
  FakeApprovals? approvalService,
  DateTime Function()? clock,
}) async {
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [
      approvalListProvider.overrideWith((ref) => approvalSource?.fetch() ?? Future.value(approvals)),
      executingTasksProvider.overrideWith((ref) => executingSource?.fetch() ?? Future.value(executing)),
      taskTitleLookupProvider.overrideWithValue(titles),
      agentServiceProvider.overrideWithValue(agent ?? FakeAgent()),
      approvalServiceProvider.overrideWithValue(approvalService ?? FakeApprovals()),
      if (clock != null) answeredClockProvider.overrideWithValue(clock),
    ],
    child: const MaterialApp(home: ApprovalsScreen()),
  ));
  await tester.pumpAndSettle();
}

/// 画面の ProviderContainer（再取得を起こすため）。
ProviderContainer approvalsContainer(WidgetTester tester) =>
    ProviderScope.containerOf(tester.element(find.byType(ApprovalsScreen)));
