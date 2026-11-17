/// Auto-run cards under the executions-screen theme filter: a card's own state
/// (action error, busy) must stay with its theme, and hiding a card must not
/// drop the per-theme auto-run fetch (the filter is display-only).
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

late ProviderContainer _container;

Future<void> _pump(WidgetTester tester, FakeThemeAutoRunService service) async {
  tester.view.physicalSize = const Size(1170, 4200);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
  SharedPreferences.setMockInitialValues({});
  _container = ProviderContainer(overrides: autoRunScreenOverrides(service, dummyThemes));
  addTearDown(_container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(
    container: _container,
    child: const MaterialApp(home: AgentExecutionScreen()),
  ));
  await _settle(tester);
}

Future<void> _settle(WidgetTester tester) async {
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
  await tester.pump(const Duration(milliseconds: 500));
}

Future<void> _showOnly(WidgetTester tester, String? themeId) async {
  _container.read(execFilterProvider.notifier).state = ExecFilter(themeId: themeId);
  await _settle(tester);
}

Future<void> _startTheme(WidgetTester tester, String themeId) async {
  await tester.tap(find.byKey(ValueKey('auto-run-start-$themeId')));
  await _settle(tester);
  await tester.tap(find.text('開始'));
  await _settle(tester);
}

void main() {
  testWidgets('テーマAの操作エラーは、Bだけの表示へ切り替えてもBに持ち越さない', (tester) async {
    final service = FakeThemeAutoRunService({});
    await _pump(tester, service);
    await _showOnly(tester, '1');

    service.failWith = '【ダミー】作業フォルダが見つかりません';
    await _startTheme(tester, '1');
    expect(find.text('【ダミー】作業フォルダが見つかりません'), findsOneWidget);

    await _showOnly(tester, '2');
    expect(find.byKey(const ValueKey('auto-run-theme-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('auto-run-action-error')), findsNothing);
    expect(find.text('【ダミー】作業フォルダが見つかりません'), findsNothing);

    // Aに戻せばAのエラーはAのカードに残っている（表示だけの絞り込み）
    await _showOnly(tester, '1');
    expect(find.text('【ダミー】作業フォルダが見つかりません'), findsOneWidget);
  });

  testWidgets('テーマAの操作待機中にBだけへ切り替えても、Bは押せて、完了後はAを読み直す', (tester) async {
    final service = FakeThemeAutoRunService({})..gate = Completer<void>();
    await _pump(tester, service);
    await _showOnly(tester, '1');

    await _startTheme(tester, '1');
    final startA = tester.widget<ButtonStyleButton>(find.byKey(const ValueKey('auto-run-start-1')));
    expect(startA.onPressed, isNull, reason: 'A は操作待機中');

    await _showOnly(tester, '2');
    final startB = tester.widget<ButtonStyleButton>(find.byKey(const ValueKey('auto-run-start-2')));
    expect(startB.onPressed, isNotNull, reason: 'A の busy を B に持ち越さない');

    service.fetched.clear();
    service.gate!.complete();
    await _settle(tester);
    expect(service.calls, ['start:1:priority']);
    expect(service.fetched, ['1'], reason: '完了後の読み直しは操作したテーマAだけ');
  });

  testWidgets('非表示にしたテーマの自動実行状態は破棄せず、再表示で再取得しない', (tester) async {
    final service = FakeThemeAutoRunService({'1': runningSnapshot('1')});
    await _pump(tester, service);
    expect(service.fetched..sort(), ['1', '2']);

    service.fetched.clear();
    await _showOnly(tester, '1');
    await _showOnly(tester, '2');
    await _showOnly(tester, null);
    expect(service.fetched, isEmpty);
    expect(find.text('自動実行中：【ダミー】rapitas 開発'), findsOneWidget);
  });
}
