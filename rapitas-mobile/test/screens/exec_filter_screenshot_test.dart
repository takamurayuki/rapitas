/// Executions screen filter bar: writes PNG captures with DUMMY data for
/// visual review (390pt wide, real Noto CJK fonts).
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
  _task('821', '【ダミー】ログアウト時のキャッシュ削除', '2'),
  _task('822', '【ダミー】一覧の読み込みを速くする', '2'),
];

DateTime _ago(int minutes) => DateTime.now().subtract(Duration(minutes: minutes));

ExecutingTask _exec(String taskId, int minutesAgo, {bool waiting = false}) => ExecutingTask(
      executionId: 'e$taskId',
      sessionId: 's$taskId',
      taskId: taskId,
      executionStatus: waiting ? 'waiting_for_input' : 'running',
      startedAt: _ago(minutesAgo),
    );

final _executing = [
  _exec('812', 12),
  _exec('813', 48, waiting: true),
  _exec('820', 5),
  _exec('821', 95, waiting: true),
];

final _resumable = [
  ResumableExecution(
      id: 'r1', taskId: '822', status: 'interrupted', canResume: true, startedAt: _ago(300),
      errorMessage: '【ダミー】デスクトップの再起動で中断しました'),
  ResumableExecution(id: 'r2', taskId: '813', status: 'interrupted', canResume: true, startedAt: _ago(600)),
];

void main() {
  final dir = Platform.environment['EXEC_FILTER_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the executions filter bar', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 3300); // iPhone 幅 390pt × 3、全節が入る高さ
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    const shots = {
      '1_before_filter': ExecFilter(),
      '2_theme_filter': ExecFilter(themeId: '2'),
      '3_search_oldest_waiting':
          ExecFilter(query: 'ログ', sort: ExecSort.oldest, status: ExecStatusFilter.waitingForInput),
    };
    for (final shot in shots.entries) {
      SharedPreferences.setMockInitialValues({});
      final container = ProviderContainer(overrides: [
        ...autoRunScreenOverrides(
          FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': idleSnapshot('2')}),
          dummyThemes,
        ),
        executingTasksProvider.overrideWith((ref) async => _executing),
        resumableExecutionsProvider.overrideWith((ref) async => _resumable),
        taskTitleLookupProvider.overrideWithValue({for (final t in _tasks) t.id: t.title}),
        taskListProvider.overrideWith((ref, filter) async => _tasks),
      ]);
      addTearDown(container.dispose);
      container.read(execFilterProvider.notifier).state = shot.value;
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
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 1);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/dummy_exec_filter_${shot.key}.png');
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
