/// Filter surfaces fill the screen width on both the tasks screen and the
/// executions screen (nav71): the filter sheet, its content column, and the
/// applied-condition chip row are measured at 390pt and compared.
///
/// The Material 3 bottom sheet wraps its child in Align + ConstrainedBox
/// (maxWidth 640), so the sheet surface shrinks to its content when the chips
/// do not fill a line. With few theme candidates the executions sheet became
/// visibly narrower than the screen; these tests pin it to the full width.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';
import 'task_filter_selection_test.dart' show FakeTaskList, buildTaskListApp, sampleTasks;

const _width = 390.0;

void _phone(WidgetTester tester) {
  tester.view.physicalSize = const Size(_width * 3, 844 * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

/// シート面（BottomSheet 直下の Material）・スクロール領域・中身の Column の幅
({double sheet, double scroll, double column}) _sheetWidths(WidgetTester tester) {
  final sheet = find.descendant(of: find.byType(BottomSheet), matching: find.byType(Material)).first;
  final scroll = find.descendant(of: sheet, matching: find.byType(SingleChildScrollView)).first;
  final column = find
      .ancestor(of: find.descendant(of: sheet, matching: find.text('フィルター')), matching: find.byType(Column))
      .first;
  return (
    sheet: tester.getSize(sheet).width,
    scroll: tester.getSize(scroll).width,
    column: tester.getSize(column).width,
  );
}

/// 開発テーマが少ない（チップが1行に満たない）状態で実行画面を出す
Future<void> _pumpExec(WidgetTester tester, ExecFilter filter) async {
  SharedPreferences.setMockInitialValues({});
  final container = ProviderContainer(overrides: [
    ...autoRunScreenOverrides(FakeThemeAutoRunService(const {}), dummyThemes),
    executingTasksProvider.overrideWith((ref) async => const []),
    resumableExecutionsProvider.overrideWith((ref) async => const []),
  ]);
  addTearDown(container.dispose);
  container.read(execFilterProvider.notifier).state = filter;
  await tester.pumpWidget(UncontrolledProviderScope(
    container: container,
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await _settle(tester);
}

void main() {
  testWidgets('実行画面とタスク画面のシートは、同じ390pt幅で同じく画面幅いっぱいに広がる', (tester) async {
    _phone(tester);
    SharedPreferences.setMockInitialValues({});
    await tester.pumpWidget(buildTaskListApp(FakeTaskList(sampleTasks)));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('フィルター'));
    await tester.pumpAndSettle();
    final task = _sheetWidths(tester);

    await _pumpExec(tester, const ExecFilter());
    await tester.tap(find.byKey(const ValueKey('exec-filter-open')));
    await _settle(tester);
    final exec = _sheetWidths(tester);
    // ignore: avoid_print
    print('sheet widths @390: task=$task exec=$exec');

    expect(task.sheet, _width);
    expect(exec.sheet, _width, reason: 'チップが少なくてもシート面は縮まない');
    expect(exec.scroll, _width);
    expect(task.scroll, _width);
    // 中身の Column も左右の余白（16）を除いた幅いっぱい。チップが少なくても縮まない
    expect(exec.column, _width - 32);
    expect(task.column, _width - 32);
    expect(tester.getSize(find.byKey(const ValueKey('exec-sheet-done'))).width, _width - 32);
  });

  testWidgets('実行画面の適用中チップ列は、本文の幅いっぱいに置く', (tester) async {
    _phone(tester);
    await _pumpExec(tester, const ExecFilter(themeIds: {'1'}));
    final row = find.byKey(const ValueKey('exec-active-filter-chips'));
    expect(row, findsOneWidget);
    // ListView の左右 8 を除いた幅いっぱい（タスク画面の列と同じく、中身の量で縮まない）
    expect(tester.getSize(row).width, _width - 16);
  });
}
