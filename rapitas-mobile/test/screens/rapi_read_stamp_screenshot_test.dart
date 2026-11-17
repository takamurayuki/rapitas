/// Rapi read stamp (nav63): writes PNG captures with DUMMY data for visual
/// review at 390pt wide — right after sending (no stamp, dots), a create turn
/// Rapi has read (🫡 on the lower right), a question turn (👌), and the
/// jump-to-latest button at the bottom centre.
///
/// Set RAPI_SCREENSHOT_DIR to write them (real Noto CJK / emoji fonts);
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

void main() {
  final dir = Platform.environment['RAPI_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the read stamp', (tester) async {
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

    late ControlledAssistant assistant;
    late ProviderContainer container;
    Future<void> fresh() async {
      SharedPreferences.setMockInitialValues({});
      assistant = ControlledAssistant();
      container = ProviderContainer(overrides: [
        assistantServiceProvider.overrideWithValue(assistant),
      ]);
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
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
    }

    Future<void> say(String text) async {
      await tester.enterText(find.byType(TextField), text);
      await tester.pump();
      await tester.tap(find.byKey(const ValueKey('rapi-send')));
      await tester.pump();
      FocusManager.instance.primaryFocus?.unfocus();
      await tester.pump(const Duration(milliseconds: 300));
    }

    // 前のやりとり（会話で 👌）を1つ置いてから、作成の依頼を送る
    await fresh();
    assistant.reply = 'おはようございます。今日もよろしくお願いします。';
    await say('【ダミー】おはよう');
    assistant.succeed();
    await tester.pumpAndSettle();

    // (1) 送信直後：まだ振り分けの応答が無いので、スタンプは無く三点だけ
    await say('【ダミー】明日の会議の資料づくりをタスクにして');
    await shot('1_sent');

    // (2) 振り分けが返った：右下に 🫡（作成の下書きは処理中のまま＝三点が続く）
    assistant.succeedAs('create', reason: '資料づくりを1つのタスクとして起こします');
    await tester.pump(const Duration(milliseconds: 300));
    await shot('2_read_create');
    container.dispose();

    // (3) 質問のターン：👌
    await fresh();
    assistant.reply = '進行中は **2件** です。\n\n- 会議資料の下書き\n- 週報のまとめ';
    await say('【ダミー】いま進行中のタスクはいくつ？');
    assistant.succeed();
    await tester.pumpAndSettle();
    await say('【ダミー】見守りの一覧も見せて');
    assistant.succeedAs('watch', reason: '要対応の一覧を見に行きます');
    await tester.pump(const Duration(milliseconds: 300));
    await shot('3_read_ask');
    container.dispose();

    // (4) 上にスクロールした状態の ▽（下端の中央）
    await fresh();
    assistant.reply = List.generate(8, (i) => '【ダミー】返答の${i + 1}段落目です。').join('\n\n');
    for (var i = 1; i <= 3; i++) {
      await say('【ダミー】質問$i');
      assistant.succeed();
      await tester.pumpAndSettle();
    }
    await tester.drag(find.byType(ListView), const Offset(0, 600));
    await tester.pumpAndSettle();
    await shot('4_jump');
    container.dispose();
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
