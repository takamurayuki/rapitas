/// Executions screen auto-run section: writes PNG captures with DUMMY data
/// for visual review (390pt wide, real Noto CJK fonts).
///
/// Set AUTO_RUN_SCREENSHOT_DIR to write them; CI leaves it unset, so the test
/// is skipped there.
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
import 'package:rapitas_mobile/screens/agent_execution/agent_execution_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/theme_auto_run_fakes.dart';

final _boundaryKey = GlobalKey();

void main() {
  final dir = Platform.environment['AUTO_RUN_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the auto-run section', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final shots = <String, (FakeThemeAutoRunService, List<TaskTheme>)>{
      '1_dev_themes': (
        FakeThemeAutoRunService({
          '1': idleSnapshot('1'),
          '2': idleSnapshot('2', lastError: '【ダミー】worktree の作成に失敗しました'),
          '4': idleSnapshot('4'),
        }),
        [...dummyThemes, noFolderTheme],
      ),
      '2_running': (
        FakeThemeAutoRunService({'1': runningSnapshot('1'), '2': pausedSnapshot('2')}),
        dummyThemes,
      ),
      '3_no_dev_themes': (FakeThemeAutoRunService({}), [dummyThemes.last]),
    };
    for (final theme in {'light': AppTheme.lightTheme, 'dark': AppTheme.darkTheme}.entries) {
      for (final shot in shots.entries) {
        SharedPreferences.setMockInitialValues({});
        await tester.pumpWidget(ProviderScope(
          key: UniqueKey(),
          overrides: autoRunScreenOverrides(shot.value.$1, shot.value.$2),
          child: RepaintBoundary(
            key: _boundaryKey,
            child: MaterialApp(
              debugShowCheckedModeBanner: false,
              theme: theme.value,
              home: const AgentExecutionScreen(),
            ),
          ),
        ));
        await tester.pumpAndSettle();
        final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
        await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 1);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('$dir/dummy_auto_run_${shot.key}_${theme.key}.png');
          file.parent.createSync(recursive: true);
          file.writeAsBytesSync(bytes!.buffer.asUint8List());
        });
      }
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
