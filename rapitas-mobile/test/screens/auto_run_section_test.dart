/// Executions screen: the theme auto-run section (development themes only,
/// start/stop POSTs to the right theme, running state shows theme + current
/// task + processed count, lastError and 400 reasons are shown verbatim).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

Future<void> _pump(WidgetTester tester, FakeThemeAutoRunService service, List<TaskTheme> themes) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(ProviderScope(
    overrides: autoRunScreenOverrides(service, themes),
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('(a) 開発テーマだけが自動実行セクションに並ぶ', (tester) async {
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1'), '2': idleSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    expect(find.text('自動実行'), findsOneWidget);
    expect(find.text('【ダミー】rapitas 開発'), findsOneWidget);
    expect(find.text('【ダミー】モバイル版'), findsOneWidget);
    expect(find.text('【ダミー】買い物メモ'), findsNothing);
    // 開発テーマでないテーマの状態は取りに行かない
    expect(service.fetched.toSet(), {'1', '2'});
  });

  testWidgets('(b) 開始は確認ダイアログを経て、選んだテーマと順番で POST する', (tester) async {
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1'), '2': idleSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    await tester.tap(find.byKey(const ValueKey('auto-run-start-2')));
    await tester.pumpAndSettle();
    expect(find.textContaining('「【ダミー】モバイル版」の未完了タスク'), findsOneWidget);
    await tester.tap(find.text('作成順'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '開始'));
    await tester.pumpAndSettle();

    expect(service.calls, ['start:2:created']);
    expect(find.text('「【ダミー】モバイル版」の自動実行を開始しました'), findsOneWidget);
  });

  testWidgets('開始の既定は優先度順、キャンセルなら POST しない', (tester) async {
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1'), '2': idleSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    await tester.tap(find.byKey(const ValueKey('auto-run-start-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('キャンセル'));
    await tester.pumpAndSettle();
    expect(service.calls, isEmpty);

    await tester.tap(find.byKey(const ValueKey('auto-run-start-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '開始'));
    await tester.pumpAndSettle();
    expect(service.calls, ['start:1:priority']);
  });

  testWidgets('(c) 自動実行中はテーマ名・現在のタスク名・処理済み件数を出す', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': idleSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    expect(find.text('自動実行中：【ダミー】rapitas 開発'), findsOneWidget);
    expect(find.text('実行中のタスク：【ダミー】ログイン画面のエラー表示を直す'), findsOneWidget);
    expect(find.textContaining('処理済み 3件'), findsOneWidget);
    expect(find.textContaining('残り 5件'), findsOneWidget);
  });

  testWidgets('現在のタスク名が応答に無ければ実行中一覧のタイトルで引く', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1', withTitle: false), '2': idleSnapshot('2')});
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ...autoRunScreenOverrides(service, dummyThemes),
        taskTitleLookupProvider.overrideWithValue(const {'812': '【ダミー】一覧から引いた名前'}),
      ],
      child: const MaterialApp(home: AgentExecutionScreen()),
    ));
    await tester.pumpAndSettle();

    expect(find.text('実行中のタスク：【ダミー】一覧から引いた名前'), findsOneWidget);
  });

  testWidgets('(d) 停止は確認のうえ、そのテーマへ stop を POST する', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': idleSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    await tester.tap(find.byKey(const ValueKey('auto-run-stop-1')));
    await tester.pumpAndSettle();
    expect(find.text('自動実行を停止'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '停止'));
    await tester.pumpAndSettle();

    expect(service.calls, ['stop:1']);
  });

  testWidgets('一時停止は pause を POST し、paused の状態は文で出す', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': idleSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    service.snapshots['1'] = pausedSnapshot('1');
    await tester.tap(find.text('一時停止'));
    await tester.pumpAndSettle();

    expect(service.calls, ['pause:1']);
    expect(find.text('一時停止中です（計画の承認待ち）。承認されると続きます。'), findsOneWidget);
    expect(find.text('再開'), findsOneWidget);
  });

  testWidgets('(e) lastError をそのまま出す', (tester) async {
    final service = FakeThemeAutoRunService({
      '1': idleSnapshot('1', lastError: 'worktree の作成に失敗しました'),
      '2': idleSnapshot('2'),
    });
    await _pump(tester, service, dummyThemes);

    expect(find.text('直近のエラー：worktree の作成に失敗しました'), findsOneWidget);
  });

  testWidgets('開始が 400 のときは理由の文面をカードに残す', (tester) async {
    const reason = '自動実行は開発モードで作業ディレクトリが設定されたテーマのみ利用できます。';
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1'), '2': idleSnapshot('2')})
      ..failWith = reason;
    await _pump(tester, service, dummyThemes);

    await tester.tap(find.byKey(const ValueKey('auto-run-start-1')));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, '開始'));
    await tester.pumpAndSettle();

    expect(find.text(reason), findsOneWidget);
    expect(find.textContaining('開始しました'), findsNothing);
  });

  testWidgets('作業フォルダ未設定の開発テーマは理由を出し、開始できない', (tester) async {
    final service = FakeThemeAutoRunService({'4': idleSnapshot('4')});
    await _pump(tester, service, [noFolderTheme]);

    expect(find.text('【ダミー】フォルダ未設定'), findsOneWidget);
    expect(find.textContaining('作業フォルダが未設定のため開始できません'), findsOneWidget);
    final button = tester.widget<ButtonStyleButton>(find.byKey(const ValueKey('auto-run-start-4')));
    expect(button.onPressed, isNull);
  });

  testWidgets('開発テーマが無いときは案内を出す', (tester) async {
    final service = FakeThemeAutoRunService({});
    await _pump(tester, service, [dummyThemes.last]);

    expect(find.byKey(const ValueKey('auto-run-empty')), findsOneWidget);
    expect(find.textContaining('開発テーマがありません'), findsOneWidget);
    // 単一タスク実行の FAB は削除済み（タスク詳細から実行する）
    expect(find.byType(FloatingActionButton), findsNothing);
  });

  testWidgets('実行中タスクがある画面でも自動実行セクションが先頭に出る', (tester) async {
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1'), '2': idleSnapshot('2')});
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(ProviderScope(
      overrides: [
        ...autoRunScreenOverrides(service, dummyThemes),
        executingTasksProvider.overrideWith((ref) async => const [
              ExecutingTask(executionId: '9', sessionId: '9', taskId: '9', executionStatus: 'waiting_for_input'),
            ]),
      ],
      child: const MaterialApp(home: AgentExecutionScreen()),
    ));
    await tester.pumpAndSettle();

    final autoRunTop = tester.getTopLeft(find.text('自動実行')).dy;
    final executingTop = tester.getTopLeft(find.text('実行中')).dy;
    expect(autoRunTop, lessThan(executingTop));
  });

  testWidgets('開始・再開ボタンはどのカードでも右端に揃い、再開は停止より右に並ぶ', (tester) async {
    final service = FakeThemeAutoRunService({'1': idleSnapshot('1'), '2': pausedSnapshot('2')});
    await _pump(tester, service, dummyThemes);

    // カードの右内側（Card の既定 margin 4 + Padding の右 12）を右端とみなす
    double innerRight(String themeId) =>
        tester.getTopRight(find.byKey(ValueKey('auto-run-theme-$themeId'))).dx - 16;

    final startRight = tester.getTopRight(find.byKey(const ValueKey('auto-run-start-1'))).dx;
    final resume = find.byKey(const ValueKey('auto-run-resume-2'));
    final resumeRight = tester.getTopRight(resume).dx;
    expect(startRight, moreOrLessEquals(innerRight('1'), epsilon: 0.5));
    expect(resumeRight, moreOrLessEquals(innerRight('2'), epsilon: 0.5));
    expect(startRight, moreOrLessEquals(resumeRight, epsilon: 0.5));

    // 同じ行の停止は再開の左
    final stopRight = tester.getTopRight(find.byKey(const ValueKey('auto-run-stop-2'))).dx;
    expect(stopRight, lessThan(tester.getTopLeft(resume).dx));
  });
}
