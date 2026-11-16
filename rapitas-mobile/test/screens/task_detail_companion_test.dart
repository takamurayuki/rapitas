/// Task detail: the 「完了条件」 and 「いまの段階」 sections (companion stage 1).
///
/// Both show DB values as they are — the acceptance criteria the jury judges
/// against, the workflow stage and any halt reason. Set
/// TASK_DETAIL_SCREENSHOT_DIR to also write PNG captures (real fonts) of the
/// screen at iPhone width for visual review; CI leaves it unset.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/task_detail/task_detail_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

final _boundaryKey = GlobalKey();

const _criteria = [
  'ログイン画面で正しいパスワードを入れるとホームに進める',
  '誤ったパスワードでは進めず、理由が画面に出る',
  '既存のログインのテストがすべて通る',
];

const _userChecks = ['本人がスマホで間違ったパスワードを入れ、理由の文が読めることを確かめる'];

Task _task({
  List<String> criteria = _criteria,
  List<String> userChecks = const [],
  String? workflowStatus = 'plan_created',
  String? haltReason,
  String status = 'in-progress',
  String description = 'パスワードを間違えたときに何も出ないので、理由を出す。',
}) =>
    Task(
      id: '1',
      title: 'ログインのエラー表示を直す',
      description: description,
      status: status,
      priority: 'high',
      estimatedHours: 2,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
      acceptanceCriteria: criteria,
      userAcceptanceChecks: userChecks,
      workflowStatus: workflowStatus,
      haltReason: haltReason,
    );

Future<void> _pump(WidgetTester tester, Task task, {ThemeData? theme}) async {
  SharedPreferences.setMockInitialValues({});
  // UniqueKey: a reused ProviderScope keeps its first override across pumps.
  await tester.pumpWidget(ProviderScope(
    key: UniqueKey(),
    overrides: [taskDetailProvider.overrideWith((ref, id) async => task)],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? AppTheme.lightTheme,
        home: const TaskDetailScreen(taskId: '1'),
      ),
    ),
  ));
  await tester.pumpAndSettle();
}

void _phone(WidgetTester tester, {double height = 2400}) {
  // iPhone width: 390 logical px at 3x.
  tester.view.physicalSize = Size(1170, height * 3);
  tester.view.devicePixelRatio = 3;
  addTearDown(tester.view.reset);
}

void main() {
  testWidgets('shows every acceptance criterion, numbered, with who judges them', (tester) async {
    _phone(tester);
    await _pump(tester, _task());
    expect(find.text('完了条件'), findsOneWidget);
    for (var i = 0; i < _criteria.length; i++) {
      expect(find.text(_criteria[i]), findsOneWidget);
      expect(find.text('${i + 1}.'), findsOneWidget);
    }
    expect(find.textContaining('完了ゲートと陪審が判定します'), findsOneWidget);
  });

  testWidgets('the person’s checks are listed apart, under their own heading (fix2 item 5)',
      (tester) async {
    _phone(tester);
    await _pump(tester, _task(userChecks: _userChecks));
    expect(find.byKey(const ValueKey('task-criteria-jury-heading')), findsOneWidget);
    expect(find.byKey(const ValueKey('task-criteria-user-heading')), findsOneWidget);
    expect(find.text('陪審が確かめる'), findsOneWidget);
    expect(find.text('本人が確かめる'), findsOneWidget);
    expect(find.byKey(const ValueKey('task-criterion-2')), findsOneWidget);
    expect(find.byKey(const ValueKey('task-user-check-0')), findsOneWidget);
    expect(find.text(_userChecks.first), findsOneWidget);
    expect(find.textContaining('陪審の判定には使いません'), findsOneWidget);
    // The jury's heading sits above its list, the person's below it.
    final juryY = tester.getTopLeft(find.byKey(const ValueKey('task-criteria-jury-heading'))).dy;
    final userY = tester.getTopLeft(find.byKey(const ValueKey('task-criteria-user-heading'))).dy;
    expect(tester.getTopLeft(find.text(_criteria.last)).dy, inExclusiveRange(juryY, userY));
  });

  testWidgets('the description lists the jury’s only; the person’s check still shows, from its column (fix3 item 1)',
      (tester) async {
    _phone(tester);
    // The shape the server now stores: the description's checklist is the jury's alone.
    final stored = 'パスワードを間違えたときに何も出ないので、理由を出す。\n\n## 完了条件\n'
        '${_criteria.map((c) => '- [ ] $c').join('\n')}';
    await _pump(tester, _task(userChecks: _userChecks, description: stored));
    expect(find.byKey(const ValueKey('task-user-check-0')), findsOneWidget);
    expect(find.text(_userChecks.first), findsOneWidget);
    final userY = tester.getTopLeft(find.byKey(const ValueKey('task-criteria-user-heading'))).dy;
    expect(tester.getTopLeft(find.text(_userChecks.first)).dy, greaterThan(userY));
  });

  testWidgets('a task with only the person’s checks says the jury has none', (tester) async {
    _phone(tester);
    await _pump(tester, _task(criteria: const [], userChecks: _userChecks));
    expect(find.text('完了条件はまだ登録されていません。'), findsNothing);
    expect(find.text('ありません（本人が確かめる条件だけのタスクです）。'), findsOneWidget);
    expect(find.text(_userChecks.first), findsOneWidget);
  });

  testWidgets('an older task (no person’s checks) shows no subheadings', (tester) async {
    _phone(tester);
    await _pump(tester, _task());
    expect(find.text('陪審が確かめる'), findsNothing);
    expect(find.text('本人が確かめる'), findsNothing);
  });

  // Stage 2: when a person must decide, the detail leads to the decision screen.
  testWidgets('a task waiting on you offers the decision screen; a running one does not',
      (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'));
    expect(find.byKey(const ValueKey('task-detail-decide')), findsOneWidget);
    expect(find.text('判断する：計画の承認'), findsOneWidget);
    await _pump(tester, _task(workflowStatus: 'in_progress', haltReason: 'no_progress'));
    expect(find.text('判断する：停止の解除'), findsOneWidget);
    await _pump(tester, _task(workflowStatus: 'in_progress'));
    expect(find.byKey(const ValueKey('task-detail-decide')), findsNothing);
  });

  testWidgets('shows the stage, its step and what is happening', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'plan_created'));
    expect(find.text('いまの段階'), findsOneWidget);
    expect(find.text('計画の承認待ち'), findsOneWidget);
    expect(find.text('3 / 7'), findsOneWidget);
    expect(find.text('計画ができました。承認すると実装に進みます。'), findsOneWidget);
  });

  testWidgets('a halted task says why, in plain words', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'in_progress', haltReason: 'budget_time_exceeded'));
    expect(find.text('実装中'), findsOneWidget);
    expect(find.text('作業時間の上限に達したため、自動で止まっています。'), findsOneWidget);
    expect(find.byIcon(Icons.pause_circle_outline), findsOneWidget);
  });

  // NOTE: This used jury_result_discarded as its unknown code. Stage 2 gives that
  // code (written by batch B) a plain sentence ahead of time, so a code no table
  // knows stands in for "unknown" now.
  testWidgets('an unknown halt code is shown, not hidden', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'in_progress', haltReason: 'some_future_halt'));
    expect(find.text('自動で止まっています（理由: some_future_halt）。'), findsOneWidget);
  });

  testWidgets('a discarded jury result (batch B) is said plainly', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'verify_done', haltReason: 'jury_result_discarded'));
    expect(find.text('確認の途中で完了条件が変わったため、その判定は使わずに止めています。'), findsOneWidget);
  });

  testWidgets('no criteria and no workflow are said plainly', (tester) async {
    _phone(tester);
    await _pump(tester, _task(criteria: const [], workflowStatus: null));
    expect(find.text('完了条件はまだ登録されていません。'), findsOneWidget);
    expect(find.text('未開始'), findsOneWidget);
    expect(find.text('エージェントの作業はまだ始まっていません。'), findsOneWidget);
    expect(find.textContaining(' / 7'), findsNothing);
  });

  testWidgets('waiting for an answer has no step count (it is off the main path)', (tester) async {
    _phone(tester);
    await _pump(tester, _task(workflowStatus: 'awaiting_question'));
    expect(find.text('回答待ち'), findsOneWidget);
    expect(find.textContaining(' / 7'), findsNothing);
  });

  final screenshotDir = Platform.environment['TASK_DETAIL_SCREENSHOT_DIR'];
  testWidgets('writes captures for visual review', (tester) async {
    await _loadRealFonts();
    final shots = <String, (Task, ThemeData)>{
      'companion_plan_light': (_task(), AppTheme.lightTheme),
      'companion_halted_light': (
        _task(workflowStatus: 'in_progress', haltReason: 'budget_time_exceeded'),
        AppTheme.lightTheme
      ),
      'companion_plan_dark': (_task(), AppTheme.darkTheme),
      'companion_two_columns_light': (_task(userChecks: _userChecks), AppTheme.lightTheme),
      'companion_two_columns_dark': (_task(userChecks: _userChecks), AppTheme.darkTheme),
      'companion_empty_light': (
        _task(criteria: const [], workflowStatus: null, status: 'todo'),
        AppTheme.lightTheme
      ),
    };
    for (final entry in shots.entries) {
      _phone(tester, height: 1150);
      await _pump(tester, entry.value.$1, theme: entry.value.$2);
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$screenshotDir/task_detail_${entry.key}.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }
  }, skip: screenshotDir == null);
}

/// Replaces the test font with real ones so the PNGs are readable.
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'MaterialIcons': [
      '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ],
  };
  for (final entry in fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      final file = File(path);
      if (!file.existsSync()) continue;
      loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    }
    await loader.load();
  }
}
