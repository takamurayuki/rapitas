/// Notes screens: writes PNG captures with DUMMY data for visual review.
///
/// Set NOTES_SCREENSHOT_DIR to write them (light/dark, real Noto CJK fonts);
/// CI leaves it unset, so the test is skipped there.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:rapitas_mobile/config/note_paths.dart';
import 'package:rapitas_mobile/config/note_routes.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/task_detail/task_detail_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/note_fakes.dart';

final _boundaryKey = GlobalKey();

final _dummyTask = Task(
  id: '101',
  title: '【ダミー】ノート機能をスマホ版に入れる',
  description: 'ダミーのタスク説明です。紐づくノートが「資料」に並びます。',
  theme: TaskTheme(id: '5', name: 'ダミーテーマ'),
  createdAt: DateTime(2026, 11, 1),
  updatedAt: DateTime(2026, 11, 13),
);

Future<GoRouter> _pump(WidgetTester tester, ThemeData theme, String location) async {
  SharedPreferences.setMockInitialValues({});
  final router = GoRouter(
    initialLocation: location,
    routes: [
      GoRoute(path: '/tasks/:id', builder: (context, state) => const TaskDetailScreen(taskId: '101')),
      ...noteRoutes,
    ],
  );
  await tester.pumpWidget(ProviderScope(
    overrides: [
      noteServiceProvider.overrideWithValue(FakeNoteService(dummyNotes())),
      taskDetailProvider.overrideWith((ref, id) async => id == '101'
          ? _dummyTask
          : Task(id: id, title: '【ダミー】別のタスク', createdAt: DateTime(2026, 11, 1), updatedAt: DateTime(2026, 11, 1))),
    ],
    child: RepaintBoundary(
      key: _boundaryKey,
      child: MaterialApp.router(debugShowCheckedModeBanner: false, theme: theme, routerConfig: router),
    ),
  ));
  await tester.pumpAndSettle();
  return router;
}

void main() {
  final dir = Platform.environment['NOTES_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the notes screens', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    final shots = <String, String>{
      'list': NotePaths.list,
      'detail': NotePaths.detailPath('1731400000001'),
      'edit': NotePaths.editPath('1731400000002'),
      'new_from_task': NotePaths.createPath(taskId: '101'),
      'task_detail_section': '/tasks/101',
    };
    for (final theme in {'light': AppTheme.lightTheme, 'dark': AppTheme.darkTheme}.entries) {
      for (final shot in shots.entries) {
        await _pump(tester, theme.value, shot.value);
        if (shot.key == 'task_detail_section') {
          await tester.scrollUntilVisible(find.byKey(const ValueKey('task-notes-section')), 300,
              scrollable: find.byType(Scrollable).first);
          await tester.pumpAndSettle();
        }
        final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
        await tester.runAsync(() async {
          final image = await boundary.toImage(pixelRatio: 3);
          final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
          final file = File('$dir/dummy_notes_${shot.key}_${theme.key}.png');
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
    'monospace': ['/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf'],
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
