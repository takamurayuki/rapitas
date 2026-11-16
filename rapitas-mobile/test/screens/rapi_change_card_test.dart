import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/rapi.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/providers/theme_data_provider.dart';
import 'package:rapitas_mobile/providers/voice_provider.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:rapitas_mobile/services/assistant_service.dart';
import 'package:rapitas_mobile/services/dictation_service.dart';

// 変更（change）カードの表示：提案（今 → 変更後）、適用 → 取り消し、409 の案内、unclear の返信。

/// 変更の振り分けと各応答をテストから決める AssistantService
class _ChangeAssistant implements AssistantService {
  ChangeDraft draft = const ChangeDraft(
    considered: 42,
    proposal: ChangeProposal(
      taskId: '7',
      title: 'ログインのバグを直す',
      changes: TaskChanges({'status': 'done', 'priority': 'urgent', 'themeId': 2}),
      reason: '「完了にして急ぎで」と言っているため',
    ),
  );
  TaskUpdateRevert revert = const TaskUpdateRevert();

  /// 設定すると taskUpdate / revertTaskUpdate がこれを投げる
  Object? updateError;
  Object? revertError;
  final List<String> calls = [];

  @override
  Future<RoutedIntent> routeIntent(String text, {bool hasOpenTask = false}) async =>
      const RoutedIntent(intent: 'change');

  @override
  Future<ChangeDraft> updateDraft(String text) async {
    calls.add('draft');
    return draft;
  }

  @override
  Future<TaskUpdateResult> taskUpdate(String taskId, TaskChanges changes) async {
    calls.add('update:$taskId:${changes.toJson()}');
    if (updateError != null) throw updateError!;
    return const TaskUpdateResult(
      actionId: 31,
      before: {'status': 'in-progress', 'priority': 'medium', 'themeId': 1},
      after: {'status': 'done', 'priority': 'urgent', 'themeId': 2},
    );
  }

  @override
  Future<TaskUpdateRevert> revertTaskUpdate(int actionId) async {
    calls.add('revert:$actionId');
    if (revertError != null) throw revertError!;
    return revert;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _IdleDictation implements DictationService {
  @override
  Future<DictationStartFailure?> start({
    required void Function(String words) onWords,
    required void Function(DictationEnd end) onEnd,
  }) async =>
      null;

  @override
  Future<void> stop() async {}

  @override
  Future<void> cancel() async {}
}

final _task = Task(
  id: '7',
  title: 'ログインのバグを直す',
  status: 'in-progress',
  priority: 'medium',
  themeId: '1',
  createdAt: DateTime(2026, 11, 1),
  updatedAt: DateTime(2026, 11, 8),
);

final _themes = [
  TaskTheme(id: '1', name: 'Webアプリ'),
  TaskTheme(id: '2', name: 'モバイル'),
];

void main() {
  late _ChangeAssistant assistant;

  Future<void> sendChange(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        dictationServiceProvider.overrideWithValue(_IdleDictation()),
        taskDetailProvider.overrideWith((ref, id) async => _task),
        themeListProvider.overrideWith((ref) async => _themes),
      ],
      child: const MaterialApp(home: RapiScreen()),
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextField), 'ログインのバグを完了にして急ぎで');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pumpAndSettle();
  }

  /// RichText（Text.rich）も含めて、表示されている文に [s] があるか
  Finder textContaining(String s) => find.byWidgetPredicate(
      (w) => w is RichText && w.text.toPlainText().contains(s));

  setUp(() => assistant = _ChangeAssistant());

  testWidgets('提案カード：対象・項目ごとの今 → 変更後・理由・ボタン。デスクトップ版の案内は出ない',
      (tester) async {
    await sendChange(tester);

    expect(find.text('この内容で変更しますか'), findsOneWidget);
    expect(find.text('ログインのバグを直す'), findsOneWidget);
    expect(textContaining('進行中  →  完了'), findsOneWidget);
    expect(textContaining('中  →  緊急'), findsOneWidget);
    expect(textContaining('Webアプリ  →  モバイル'), findsOneWidget);
    expect(find.text('「完了にして急ぎで」と言っているため'), findsOneWidget);
    expect(find.text('最近更新された42件の中から選びました'), findsOneWidget);
    expect(find.text('適用する'), findsOneWidget);
    expect(find.text('やめる'), findsOneWidget);
    expect(textContaining('デスクトップ版'), findsNothing);
    expect(assistant.calls, ['draft']);
  });

  testWidgets('適用 → 取り消し', (tester) async {
    await sendChange(tester);

    await tester.tap(find.text('適用する'));
    await tester.pumpAndSettle();
    expect(assistant.calls.last, 'update:7:{status: done, priority: urgent, themeId: 2}');
    expect(find.text('変更しました'), findsOneWidget);
    expect(find.text('適用する'), findsNothing);
    expect(textContaining('進行中  →  完了'), findsOneWidget);
    expect(find.text('取り消す'), findsOneWidget);

    await tester.tap(find.text('取り消す'));
    await tester.pumpAndSettle();
    expect(assistant.calls.last, 'revert:31');
    expect(find.text('元に戻しました'), findsOneWidget);
    expect(find.text('変更前の内容に戻しました。'), findsOneWidget);
    expect(find.text('取り消す'), findsNothing);
  });

  testWidgets('取り消しが 409 なら競合した項目を案内する', (tester) async {
    assistant.revert = const TaskUpdateRevert(conflicts: ['status', 'priority']);
    await sendChange(tester);
    await tester.tap(find.text('適用する'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('取り消す'));
    await tester.pumpAndSettle();

    expect(textContaining('その後に「状態」「優先度」が変更されたため、元に戻せませんでした。'), findsOneWidget);
    expect(find.text('取り消す'), findsNothing);
    expect(find.text('変更しました'), findsOneWidget);
  });

  testWidgets('適用がタイムアウトしたら結果不明：「適用する」は出さず「タスクを開く」を出す',
      (tester) async {
    assistant.updateError = const AssistantTimeoutException(DioExceptionType.receiveTimeout);
    await sendChange(tester);

    await tester.tap(find.text('適用する'));
    await tester.pumpAndSettle();

    expect(find.text('変更できたか確かめられませんでした'), findsOneWidget);
    expect(find.textContaining('反映済みの場合もあるため'), findsOneWidget);
    expect(find.text('適用する'), findsNothing);
    expect(find.widgetWithText(FilledButton, '適用する'), findsNothing);
    expect(find.text('やめる'), findsNothing);
    expect(find.text('取り消す'), findsNothing);
    expect(find.text('タスクを開く'), findsOneWidget);
    // 変更後の値は残して見せる（今の値は分からないので出さない）
    expect(textContaining('完了'), findsOneWidget);
    expect(textContaining('進行中  →'), findsNothing);
    expect(assistant.calls.where((c) => c.startsWith('update:')).length, 1);
  });

  testWidgets('取り消しが no_undoable_update なら取り消すボタンを下げて案内する', (tester) async {
    assistant.revertError =
        const AssistantException('no_undoable_update', statusCode: 404);
    await sendChange(tester);
    await tester.tap(find.text('適用する'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('取り消す'));
    await tester.pumpAndSettle();

    expect(find.text('取り消せる記録がありません'), findsOneWidget);
    expect(find.textContaining('既に取り消し済みの可能性があります'), findsOneWidget);
    expect(find.text('取り消す'), findsNothing);
    expect(find.text('タスクを開く'), findsOneWidget);
    expect(find.textContaining('タスクが見つかりません'), findsNothing);
  });

  testWidgets('「やめる」でカードを下げる', (tester) async {
    await sendChange(tester);

    await tester.tap(find.text('やめる'));
    await tester.pumpAndSettle();

    expect(find.text('この内容で変更しますか'), findsNothing);
    expect(assistant.calls, ['draft']);
  });

  testWidgets('unclear はラピの返信として出す', (tester) async {
    assistant.draft = const ChangeDraft(
      considered: 60,
      unclear: ['どのタスクのことか特定できませんでした。'],
    );
    await sendChange(tester);

    expect(find.text('この内容で変更しますか'), findsNothing);
    // ラピの返信は SelectableText なので find.textContaining で探す
    expect(find.textContaining('どのタスクのことか特定できませんでした。'), findsOneWidget);
    expect(find.textContaining('もう一度送ってください'), findsOneWidget);
  });
}
