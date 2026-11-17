/// Rapi chat feel: writes PNG captures with DUMMY data for visual review —
/// the received stamp, the waving dots (two phases), the jump-to-latest
/// button and a rich Markdown reply, at 390pt wide.
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
import 'package:rapitas_mobile/screens/rapi/rapi_typing_indicator.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../support/rapi_controlled_assistant.dart';

final _boundaryKey = GlobalKey();

const _richReply = '''## 今週の進め方

まずは **資料づくり** を片付けましょう。*急ぎではない* 作業は後ろに回します。

### やること
- 下書きを書く（`docs/plan.md`）
- 図を入れる
  - 構成図
  - 画面の流れ
1. レビューを頼む
2. 直して出す

> 締め切りは金曜です。

| タスク | 見積もり | 状態 |
| --- | --- | --- |
| 下書き | 2時間 | 進行中 |
| 図 | 1時間 | 未着手 |

```bash
flutter test --timeout 60s test/screens/rapi_chat_markdown_test.dart
```

詳しくは [手順書](https://example.com/guide) を見てください。''';

void main() {
  final dir = Platform.environment['RAPI_SCREENSHOT_DIR'];

  testWidgets('writes dummy-data captures of the Rapi chat feel', (tester) async {
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
      await tester.pump(const Duration(milliseconds: 300));
    }

    // (1) スタンプ付きの会話（2つ目は送信失敗でスタンプなし）
    await fresh();
    assistant.reply = '承知しました。明日の会議の資料づくりから始めましょう。';
    await say('【ダミー】明日の会議の資料を作りたい');
    assistant.succeed();
    await tester.pumpAndSettle();
    await say('【ダミー】この送信は失敗する');
    assistant.fail();
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    await shot('1_stamp');

    // (2) 考え中の三点（位相の違う2コマ）
    await say('【ダミー】進行中のタスクは？');
    await tester.pump(rapiTypingStep);
    await shot('2_typing_a');
    await tester.pump(rapiTypingStep * 3);
    await shot('2_typing_b');
    assistant.succeed();
    await tester.pumpAndSettle();
    container.dispose();

    // (3) 上にスクロールした状態の ▽
    await fresh();
    assistant.reply = List.generate(8, (i) => '【ダミー】返答の${i + 1}段落目です。').join('\n\n');
    for (var i = 1; i <= 3; i++) {
      await say('【ダミー】質問$i');
      assistant.succeed();
      await tester.pumpAndSettle();
    }
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.drag(find.byType(ListView), const Offset(0, 600));
    await tester.pumpAndSettle();
    await shot('3_jump');
    container.dispose();

    // (4) Markdown の濃い返答（見出し・箇条書き・太字・コード・表）
    await fresh();
    assistant.reply = _richReply;
    await say('【ダミー】今週の進め方をまとめて');
    assistant.succeed();
    await tester.pumpAndSettle();
    FocusManager.instance.primaryFocus?.unfocus();
    await tester.pumpAndSettle();
    // 返答は1画面に収まるので、末尾の1枚で見出しから末尾まで写る
    await shot('4_markdown');
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
