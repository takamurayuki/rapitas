/// Rapi reply → note: writes PNG captures with DUMMY data for visual review —
/// the save button on a reply card, the snackbar and saved state after a
/// save, and the saved note opened in the note detail screen, at 390pt wide.
///
/// Set RAPI_SCREENSHOT_DIR to write them (real Noto CJK fonts);
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
import 'package:rapitas_mobile/config/note_routes.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/note_fakes.dart';
import '../support/rapi_controlled_assistant.dart';

final _boundaryKey = GlobalKey();

const _reply = '''ログインのバグは、次の順に見ていくのが早いです。

- **再現手順**を書き出す（どの端末・どの画面で起きるか）
- サーバーのログで `401` が出ていないか確かめる
- 直近で変えた認証まわりの差分を読む

> まずは再現できる条件を1つに絞りましょう。''';

void main() {
  final dir = Platform.environment['RAPI_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of saving a Rapi reply as a note', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    Future<void> shot(String name) async {
      final boundary = tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$dir/mobile_$name.png');
        file.parent.createSync(recursive: true);
        file.writeAsBytesSync(bytes!.buffer.asUint8List());
      });
    }

    SharedPreferences.setMockInitialValues({});
    final assistant = ControlledAssistant()..reply = _reply;
    final notes = FakeNoteService();
    final router = GoRouter(
      initialLocation: '/rapi',
      routes: [
        GoRoute(path: '/rapi', builder: (context, state) => const RapiScreen()),
        ...noteRoutes,
      ],
    );
    await tester.pumpWidget(ProviderScope(
      overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
        noteServiceProvider.overrideWithValue(notes),
      ],
      child: RepaintBoundary(
        key: _boundaryKey,
        child: MaterialApp.router(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.lightTheme,
          routerConfig: router,
        ),
      ),
    ));
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextField), '【ダミー】ログインのバグはどこから調べればいい？');
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pump();
    assistant.succeed();
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await shot('note_1_save_button');

    await tester.tap(find.text('ノートに保存'));
    await tester.pumpAndSettle();
    await shot('note_2_saved');

    await tester.tap(find.text('開く'));
    await tester.pumpAndSettle();
    await shot('note_3_detail');
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
    'Noto Color Emoji': ['/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf'],
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
