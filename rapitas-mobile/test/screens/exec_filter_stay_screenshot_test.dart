/// Executions screen (nav73): writes PNG captures with DUMMY data for visual
/// review (390pt wide, real Noto CJK fonts) — the filter sheet kept open after
/// choosing a theme and a status, the auto-run section under 状態＝実行中, and
/// the auto-run section under 状態＝入力待ち.
///
/// Set EXEC_FILTER_SCREENSHOT_DIR to write them; CI leaves it unset, so the
/// test is skipped there.
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
import 'package:rapitas_mobile/models/task_execution.dart';
import 'package:rapitas_mobile/models/theme_auto_run.dart';
import 'package:rapitas_mobile/providers/execution_provider.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:rapitas_mobile/screens/agent_execution/exec_filter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

Task _task(String id, String title, String themeId) => Task(
      id: id,
      title: title,
      themeId: themeId,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

final _tasks = [
  _task('812', '【ダミー】ログイン画面のエラー表示を直す', '1'),
  _task('813', '【ダミー】ログ出力の整理', '1'),
  _task('820', '【ダミー】通知設定画面を作る', '2'),
];

DateTime _ago(int minutes) => DateTime.now().subtract(Duration(minutes: minutes));

ExecutingTask _exec(String taskId, int minutesAgo, {bool waiting = false}) => ExecutingTask(
      executionId: 'e$taskId',
      sessionId: 's$taskId',
      taskId: taskId,
      executionStatus: waiting ? 'waiting_for_input' : 'running',
      startedAt: _ago(minutesAgo),
    );

/// 812（テーマ1の自動実行の現在のタスク）は実行中、820（テーマ2の自動実行の現在のタスク）は入力待ち
final _executing = [_exec('812', 12), _exec('820', 5, waiting: true), _exec('813', 48, waiting: true)];

ThemeAutoRunSnapshot _running(String themeId, String taskId, String title) => ThemeAutoRunSnapshot(
      state: ThemeAutoRunState(
          themeId: themeId, enabled: true, status: 'running', currentTaskId: taskId, processedCount: 2),
      currentTaskTitle: title,
      remainingCount: 4,
    );

/// テーマ1・2は自動実行中、5は一時停止中（categorizedThemes の開発テーマ3件）
final _snapshots = {
  '1': _running('1', '812', '【ダミー】ログイン画面のエラー表示を直す'),
  '2': _running('2', '820', '【ダミー】通知設定画面を作る'),
  '5': pausedSnapshot('5'),
};

typedef _Prepare = Future<void> Function(WidgetTester tester);

Future<void> _tapKey(WidgetTester tester, String key) async {
  await tester.tap(find.byKey(ValueKey(key)));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 500));
}

void main() {
  final dir = Platform.environment['EXEC_FILTER_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the nav73 executions filter', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final shots = <String, (ExecFilter, _Prepare?)>{
      // シートを開き、テーマと状態を続けて選んだところ（閉じずに完了ボタンが見えている）
      '1_sheet_theme_and_status': (
        const ExecFilter(),
        (tester) async {
          await _tapKey(tester, 'exec-filter-open');
          await _tapKey(tester, 'exec-sheet-theme-1');
          await _tapKey(tester, 'exec-sheet-theme-2');
          await _tapKey(tester, 'exec-sheet-status-running');
          // シートの高さ上限で完了ボタンは下に隠れるので、そこまでスクロールして写す
          await tester.ensureVisible(find.byKey(const ValueKey('exec-sheet-done')));
        },
      ),
      '2_status_running_auto_run': (const ExecFilter(status: ExecStatusFilter.running), null),
      '3_status_waiting_auto_run': (const ExecFilter(status: ExecStatusFilter.waitingForInput), null),
    };
    for (final shot in shots.entries) {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer(overrides: [
        ...autoRunScreenOverrides(FakeThemeAutoRunService(_snapshots), categorizedThemes),
        executingTasksProvider.overrideWith((ref) async => _executing),
        resumableExecutionsProvider.overrideWith((ref) async => const <ResumableExecution>[]),
        taskTitleLookupProvider.overrideWithValue({for (final t in _tasks) t.id: t.title}),
        taskListProvider.overrideWith((ref, filter) async => _tasks),
      ]);
      addTearDown(container.dispose);
      container.read(execFilterProvider.notifier).state = shot.value.$1;
      final boundaryKey = GlobalKey();
      await tester.pumpWidget(UncontrolledProviderScope(
        key: UniqueKey(),
        container: container,
        child: RepaintBoundary(
          key: boundaryKey,
          child: MaterialApp(
            debugShowCheckedModeBanner: false,
            theme: AppTheme.lightTheme,
            home: const AgentExecutionScreen(),
          ),
        ),
      ));
      // 実行中タイルのスピナーは止まらないので、一定時間だけ進めてから撮る
      await tester.pump();
      await tester.pump(const Duration(seconds: 1));
      final prepare = shot.value.$2;
      if (prepare != null) {
        await prepare(tester);
        await tester.pump(const Duration(seconds: 1));
      }
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/dummy_exec_filter_nav73_${shot.key}.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }
  }, skip: dir == null);
}

/// Replaces the test font with real ones so the PNGs are readable.
Future<void> _loadRealFonts() async {
  final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
  final fonts = <String, List<String>>{
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'MaterialIcons': ['$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf'],
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
