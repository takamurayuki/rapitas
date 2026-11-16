import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/services/voice_mode_listener.dart';
import 'package:rapitas_mobile/widgets/voice_mode_indicator.dart';

// 聞き取り表示のアイコンの描画確認（スクリーンショット）。ふだんのテストでは何もしない。
// 撮るとき：VOICE_SCREENSHOT_DIR=<出力先> flutter test test/widgets/voice_mode_screenshot_test.dart
// 文字（タイトル・説明）を読めるよう、端末にあるフォントを読み込む（VOICE_SCREENSHOT_FONT_DIR で指定。無ければ文字は豆腐）。

const _states = [
  (VoiceModeStatus.ready, '話せます（入力なし）'),
  (VoiceModeStatus.hearing, '声を受け取り中'),
  (VoiceModeStatus.processing, '処理中'),
  (VoiceModeStatus.awaiting, '回答待ち'),
  (VoiceModeStatus.preparing, '準備中・再開中'),
  (VoiceModeStatus.paused, '一時停止'),
  (VoiceModeStatus.unavailable, '使えない'),
];

Future<void> _loadFont(String family, List<String> paths) async {
  final loader = FontLoader(family);
  var any = false;
  for (final path in paths) {
    final file = File(path);
    if (!file.existsSync()) continue;
    loader.addFont(Future.value(ByteData.sublistView(file.readAsBytesSync())));
    any = true;
  }
  if (any) await loader.load();
}

void main() {
  final outDir = Platform.environment['VOICE_SCREENSHOT_DIR'];

  Future<void> capture(WidgetTester tester, GlobalKey key, String name) async {
    final boundary = key.currentContext!.findRenderObject()! as RenderRepaintBoundary;
    await tester.runAsync(() async {
      final image = await boundary.toImage(pixelRatio: 2);
      final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
      File('$outDir/$name.png').writeAsBytesSync(bytes!.buffer.asUint8List());
    });
  }

  testWidgets('聞き取り表示のアイコンを撮る', (tester) async {
    final fontDir = Platform.environment['VOICE_SCREENSHOT_FONT_DIR'] ?? '/usr/share/fonts/opentype/noto';
    final flutterRoot = Platform.environment['FLUTTER_ROOT'] ?? '';
    await tester.runAsync(() async {
      await _loadFont('Shot', ['$fontDir/NotoSansCJK-Regular.ttc']);
      await _loadFont('MaterialIcons', ['$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf']);
    });
    tester.view.physicalSize = const Size(1400, 1100);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);

    Widget bar(VoiceModeStatus status, String caption, Brightness brightness) {
      return Theme(
        data: ThemeData(brightness: brightness, fontFamily: 'Shot', useMaterial3: true),
        child: Builder(
          builder: (context) => Container(
            width: 330,
            color: Theme.of(context).colorScheme.surface,
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              AppBar(
                automaticallyImplyLeading: false,
                leading: const Icon(Icons.menu),
                title: const Text('タスク'),
                actions: [
                  Center(
                    child: SizedBox(
                      width: VoiceModeIndicator.slotWidth,
                      child: Center(child: VoiceModeDot(status: status, onTap: () {})),
                    ),
                  ),
                  IconButton(onPressed: () {}, icon: const Icon(Icons.search)),
                  IconButton(onPressed: () {}, icon: const Icon(Icons.filter_list)),
                ],
              ),
              Padding(
                padding: const EdgeInsets.all(6),
                child: Text(caption, style: TextStyle(fontSize: 12, color: Theme.of(context).colorScheme.onSurface)),
              ),
            ]),
          ),
        ),
      );
    }

    final zoomKey = GlobalKey();
    final barsKey = GlobalKey();
    await tester.pumpWidget(MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData(fontFamily: 'Shot'),
      home: Scaffold(
        backgroundColor: const Color(0xFFE8E8EC),
        body: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            RepaintBoundary(
              key: zoomKey,
              child: Container(
                color: const Color(0xFFE8E8EC),
                padding: const EdgeInsets.all(12),
                child: Wrap(spacing: 10, runSpacing: 10, children: [
                  for (final (status, caption) in _states)
                    Container(
                      width: 130,
                      padding: const EdgeInsets.symmetric(vertical: 12),
                      decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(14)),
                      child: Column(children: [
                        Transform.scale(
                          scale: 1.7,
                          child: VoiceModeDot(status: status, onTap: () {}),
                        ),
                        const SizedBox(height: 18),
                        Text(caption, style: const TextStyle(fontSize: 11, color: Color(0xFF555555))),
                        Text(status.name, style: const TextStyle(fontSize: 10, color: Color(0xFF999999))),
                      ]),
                    ),
                ]),
              ),
            ),
            RepaintBoundary(
              key: barsKey,
              child: Container(
                color: const Color(0xFFE8E8EC),
                padding: const EdgeInsets.all(12),
                child: Wrap(spacing: 10, runSpacing: 10, children: [
                  for (final (status, caption) in _states) bar(status, caption, Brightness.light),
                  for (final (status, caption) in _states) bar(status, '$caption（ダーク）', Brightness.dark),
                ]),
              ),
            ),
          ]),
        ),
      ),
    ));
    // 動くもの（明滅・回転）は途中の姿で撮る
    await tester.pump(const Duration(milliseconds: 400));

    // 撮らないときも、全部の状態が例外なく描けることは確かめる
    expect(find.byType(VoiceModeDot), findsNWidgets(_states.length * 3));
    if (outDir == null) return;
    Directory(outDir).createSync(recursive: true);
    await capture(tester, zoomKey, 'voice-indicator-zoom');
    await capture(tester, barsKey, 'voice-indicator-appbar');
  });
}
