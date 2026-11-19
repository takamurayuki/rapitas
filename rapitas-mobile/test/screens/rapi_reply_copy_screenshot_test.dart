/// Rapi reply copy button: writes PNG captures with DUMMY data for visual
/// review — the copy icon at the top right of a reply card, and the snackbar
/// plus check icon right after a copy, at 390pt wide.
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
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_controlled_assistant.dart';

final _boundaryKey = GlobalKey();

const _reply = '''【ダミー】ログインのバグは、次の順に見ていくのが早いです。

- **再現手順**を書き出す（どの端末・どの画面で起きるか）
- サーバーのログで `401` が出ていないか確かめる
- 直近で変えた認証まわりの差分を読む

> まずは再現できる条件を1つに絞りましょう。''';

void main() {
  final dir = Platform.environment['RAPI_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of copying a Rapi reply', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1170, 2532); // iPhone 幅 390pt × 3
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    String? copied;
    tester.binding.defaultBinaryMessenger.setMockMethodCallHandler(SystemChannels.platform,
        (call) async {
      if (call.method == 'Clipboard.setData') {
        copied = (call.arguments as Map)['text'] as String?;
      }
      return null;
    });
    addTearDown(() => tester.binding.defaultBinaryMessenger
        .setMockMethodCallHandler(SystemChannels.platform, null));

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
    await tester.pumpWidget(ProviderScope(
      overrides: [assistantServiceProvider.overrideWithValue(assistant)],
      child: RepaintBoundary(
        key: _boundaryKey,
        child: MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: AppTheme.lightTheme,
          home: const RapiScreen(),
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
    await shot('copy_1_icon');

    await tester.tap(find.byTooltip('返答をコピー').last);
    // スナックバーが出きってチェックがまだ残っている時点を撮る
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 400));
    expect(copied, _reply);
    await shot('copy_2_copied');

    await tester.pump(const Duration(seconds: 5));
    await tester.pumpAndSettle();
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
