/// Executions filter sheet: theme candidates are development themes only
/// (grouped by category; categories without one are hidden), switching the
/// category only swaps the candidates, a non-development theme that is
/// already selected stays selected, and every chip applies at once while the
/// sheet stays open until 完了 / a barrier tap.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter_sheet.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

late ProviderContainer _container;

Future<void> _pump(WidgetTester tester, {ExecFilter filter = const ExecFilter(), List<TaskTheme>? themes}) async {
  tester.view.physicalSize = const Size(1170, 4200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({});
  _container = ProviderContainer(
      overrides: autoRunScreenOverrides(FakeThemeAutoRunService(const {}), themes ?? categorizedThemes));
  addTearDown(_container.dispose);
  _container.read(execFilterProvider.notifier).state = filter;
  await tester.pumpWidget(UncontrolledProviderScope(
    container: _container,
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await _settle(tester);
  await tester.tap(find.byKey(const ValueKey('exec-filter-open')));
  await _settle(tester);
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

Finder _key(String key) => find.byKey(ValueKey(key));

bool _selected(WidgetTester tester, String key) {
  final widget = tester.widget(_key(key));
  return widget is ChoiceChip ? widget.selected : (widget as FilterChip).selected;
}

void main() {
  test('候補は開発テーマだけをカテゴリでまとめ、開発テーマの無いカテゴリは出さない', () {
    final groups = execThemeCandidateGroups(categorizedThemes);
    expect(groups.map((g) => g.categoryId), ['c1', 'c3']);
    expect(groups[0].themes.map((t) => t.id), ['1', '2']);
    expect(groups[1].themes.map((t) => t.id), ['5']);
    expect(execThemeCandidateGroups([categorizedThemes[2]]), isEmpty);
    // カテゴリなしの開発テーマは「その他」に残す
    expect(execThemeCandidateGroups(dummyThemes).single.themes.map((t) => t.id), ['1', '2']);
  });

  testWidgets('シートの並びはカテゴリ → テーマ → 状態 → 並び順。非開発テーマとそのカテゴリは出ない', (tester) async {
    await _pump(tester);

    expect(_key('exec-sheet-category-c1'), findsOneWidget);
    expect(_key('exec-sheet-category-c3'), findsOneWidget);
    expect(_key('exec-sheet-category-c2'), findsNothing, reason: '開発テーマの無い学習カテゴリは出さない');
    expect(_selected(tester, 'exec-sheet-category-c1'), isTrue);
    expect(find.text('【ダミー】rapitas 開発（12）'), findsOneWidget);
    expect(find.text('【ダミー】英単語（30）'), findsNothing);

    double top(String text) => tester.getTopLeft(find.text(text)).dy;
    expect(top('カテゴリ'), lessThan(top('テーマ')));
    expect(top('テーマ'), lessThan(top('状態')));
    expect(top('状態'), lessThan(top('並び順')));
  });

  testWidgets('カテゴリの切り替えは候補を替えるだけで条件は変えず、シートも閉じない', (tester) async {
    await _pump(tester);

    await tester.tap(_key('exec-sheet-category-c3'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsOneWidget);
    expect(_container.read(execFilterProvider), const ExecFilter());
    expect(_key('exec-sheet-theme-5'), findsOneWidget);
    expect(_key('exec-sheet-theme-6'), findsNothing, reason: '同じカテゴリでも非開発テーマは出さない');
    expect(_key('exec-sheet-theme-1'), findsNothing);
    expect(_selected(tester, 'exec-sheet-theme-all'), isTrue);

    await tester.tap(_key('exec-sheet-theme-5'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsOneWidget, reason: 'テーマは複数選択なので閉じない');
    expect(_container.read(execFilterProvider), const ExecFilter(themeIds: {'5'}));
    // 別カテゴリに切り替えて足しても、前のカテゴリで選んだテーマは残る
    await tester.tap(_key('exec-sheet-category-c1'));
    await _settle(tester);
    await tester.tap(_key('exec-sheet-theme-1'));
    await _settle(tester);
    expect(_container.read(execFilterProvider), const ExecFilter(themeIds: {'5', '1'}));
    await tester.tap(_key('exec-sheet-done'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsNothing);
  });

  testWidgets('選択中テーマのカテゴリで開き、非開発テーマが選ばれていてもシートは解除しない', (tester) async {
    await _pump(tester, filter: const ExecFilter(themeIds: {'5'}));
    expect(_selected(tester, 'exec-sheet-category-c3'), isTrue);
    expect(_selected(tester, 'exec-sheet-theme-5'), isTrue);
    Navigator.of(tester.element(_key('exec-filter-sheet'))).pop();
    await _settle(tester);

    _container.read(execFilterProvider.notifier).state = const ExecFilter(themeIds: {'6'});
    await _settle(tester);
    expect(find.text('テーマ：【ダミー】買い物メモ'), findsOneWidget);
    await tester.tap(_key('exec-filter-open'));
    await _settle(tester);
    expect(_selected(tester, 'exec-sheet-category-c1'), isTrue, reason: '候補に無いテーマなら先頭のカテゴリで開く');
    expect(_selected(tester, 'exec-sheet-theme-all'), isFalse);
    expect(_container.read(execFilterProvider).themeIds, {'6'});
  });

  testWidgets('カテゴリ未所属の開発テーマだけを選んで開くと「その他」グループで開く', (tester) async {
    // カテゴリつき開発テーマと、カテゴリ未所属の開発テーマ（noFolderTheme, id 4）を混在させる
    await _pump(tester, filter: const ExecFilter(themeIds: {'4'}), themes: [...categorizedThemes, noFolderTheme]);
    expect(_selected(tester, 'exec-sheet-category-none'), isTrue, reason: '未所属テーマのグループ（カテゴリID null）を先頭へ置き換えない');
    expect(_selected(tester, 'exec-sheet-category-c1'), isFalse);
    expect(_selected(tester, 'exec-sheet-theme-4'), isTrue);
  });

  testWidgets('テーマ → 状態 → 並び順を1回のシートで続けて選べ、どれを選んでも閉じない', (tester) async {
    await _pump(tester);

    await tester.tap(_key('exec-sheet-theme-1'));
    await _settle(tester);
    await tester.tap(_key('exec-sheet-theme-2'));
    await _settle(tester);
    await tester.tap(_key('exec-sheet-status-running'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsOneWidget, reason: '状態を選んでも閉じない');
    expect(_selected(tester, 'exec-sheet-status-running'), isTrue);
    expect(_selected(tester, 'exec-sheet-theme-1'), isTrue, reason: 'テーマの選択はそのまま見えている');
    await tester.tap(_key('exec-sheet-sort-oldest'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsOneWidget, reason: '並び順を選んでも閉じない');
    // 状態は選び直せる（開き直さずに別の状態へ切り替えられる）
    await tester.tap(_key('exec-sheet-status-waitingForInput'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsOneWidget);
    expect(
      _container.read(execFilterProvider),
      const ExecFilter(themeIds: {'1', '2'}, status: ExecStatusFilter.waitingForInput, sort: ExecSort.oldest),
      reason: 'タップの時点で即適用する',
    );

    await tester.tap(_key('exec-sheet-done'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsNothing, reason: '「完了」で閉じる');
    expect(_container.read(execFilterProvider).status, ExecStatusFilter.waitingForInput);
  });

  testWidgets('バリアのタップでも閉じ、閉じる前に選んだ条件は残る', (tester) async {
    await _pump(tester);

    await tester.tap(_key('exec-sheet-sort-oldest'));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsOneWidget);
    await tester.tapAt(const Offset(195, 20));
    await _settle(tester);
    expect(_key('exec-filter-sheet'), findsNothing);
    expect(_container.read(execFilterProvider), const ExecFilter(sort: ExecSort.oldest));
  });
}
