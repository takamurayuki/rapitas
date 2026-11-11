/// Task detail screen: the description is rendered as Markdown inside the
/// screen's own list (no nested vertical scroller).
///
/// Set TASK_DETAIL_SCREENSHOT_DIR to also write light/dark PNG screenshots
/// with real fonts (Roboto/Noto CJK) for visual review; CI leaves it unset.
library;

import 'dart:io';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter/services.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/config/theme.dart';
import 'package:rapitas_mobile/models/task.dart';
import 'package:rapitas_mobile/providers/task_provider.dart';
import 'package:rapitas_mobile/screens/task_detail/task_detail_screen.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../widgets/markdown/markdown_sample.dart';

final _boundaryKey = GlobalKey();

Task _task(String? description) => Task(
      id: '1',
      title: 'Markdown 説明のタスク',
      description: description,
      createdAt: DateTime(2026, 11, 1),
      updatedAt: DateTime(2026, 11, 1),
    );

Future<void> _pumpDetail(
  WidgetTester tester,
  Task task, {
  ThemeData? theme,
}) async {
  SharedPreferences.setMockInitialValues({});
  await tester.pumpWidget(ProviderScope(
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

Finder _rich(String text) => find.textContaining(text, findRichText: true);

void main() {
  testWidgets('renders headings, emphasis, lists, checkboxes, code, quote, link and table',
      (tester) async {
    tester.view.physicalSize = const Size(1080, 4800);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await _pumpDetail(tester, _task(markdownSampleDescription));

    expect(find.byType(MarkdownBody), findsOneWidget);
    for (final text in [
      '見出し1',
      '見出し2',
      '見出し3',
      '太字',
      'inline code',
      '箇条書きA',
      '入れ子',
      '番号付き2',
      '完了したチェック項目',
      'コードブロック',
      '引用ブロックの文章',
      '公式サイト',
      '見積もり',
      '2時間',
    ]) {
      expect(_rich(text), findsWidgets, reason: text);
    }
    // Markdown syntax must not leak into the rendered text.
    for (final raw in ['# ', '**', '- [x]', '```', '| ---', '](https']) {
      expect(_rich(raw), findsNothing, reason: raw);
    }
    expect(find.byIcon(Icons.check_box), findsOneWidget);
    expect(find.byIcon(Icons.check_box_outline_blank), findsOneWidget);
    expect(find.byType(Table), findsOneWidget);
    // Single newlines keep breaking the line, as with the former plain Text.
    expect(_rich('1行目\n2行目'), findsOneWidget);
  });

  testWidgets('description grows inside the list instead of scrolling on its own',
      (tester) async {
    await _pumpDetail(tester, _task(markdownSampleDescription));

    final vertical = tester
        .widgetList<Scrollable>(find.byType(Scrollable))
        .where((s) => axisDirectionToAxis(s.axisDirection) == Axis.vertical);
    expect(vertical, hasLength(1), reason: 'only the screen ListView scrolls vertically');
    expect(
      find.ancestor(of: find.byType(MarkdownBody), matching: find.byType(ListView)),
      findsOneWidget,
    );
  });

  testWidgets('no description section when the description is empty', (tester) async {
    await _pumpDetail(tester, _task(''));
    expect(find.byType(MarkdownBody), findsNothing);
    expect(find.text('説明'), findsNothing);
  });

  final screenshotDir = Platform.environment['TASK_DETAIL_SCREENSHOT_DIR'];
  testWidgets('writes light/dark screenshots', (tester) async {
    await _loadRealFonts();
    tester.view.physicalSize = const Size(1080, 4200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    for (final entry in {
      'light': AppTheme.lightTheme,
      'dark': AppTheme.darkTheme,
    }.entries) {
      await _pumpDetail(tester, _task(markdownSampleDescription), theme: entry.value);
      final boundary =
          tester.renderObject<RenderRepaintBoundary>(find.byKey(_boundaryKey));
      await tester.runAsync(() async {
        final image = await boundary.toImage(pixelRatio: 3);
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        final file = File('$screenshotDir/task_detail_markdown_${entry.key}.png');
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
    // The Android test typography asks for "Roboto"; the CJK font also covers
    // Latin, so it renders the whole Japanese UI.
    'Roboto': [
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc',
    ],
    'monospace': ['/usr/share/fonts/truetype/noto/NotoSansMono-Regular.ttf'],
    'MaterialIcons': [
      '$flutterRoot/bin/cache/artifacts/material_fonts/MaterialIcons-Regular.otf',
    ],
  };
  for (final entry in fonts.entries) {
    final loader = FontLoader(entry.key);
    for (final path in entry.value) {
      final file = File(path);
      if (!file.existsSync()) continue;
      final bytes = file.readAsBytesSync();
      loader.addFont(Future.value(ByteData.sublistView(bytes)));
    }
    await loader.load();
  }
}
