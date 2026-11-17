import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/providers/service_providers.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_chat_lines.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_message_markdown.dart';
import 'package:rapitas_mobile/screens/rapi/rapi_screen.dart';

import '../support/rapi_controlled_assistant.dart';

// ラピの返答（Markdown）が記号のまま出ずに体裁を整えて描かれること（太字・箇条書き・見出し・コード・リンク）と、
// ユーザーの発言は Markdown にしないことを確かめる。

/// 描かれた文の中から、[text] を含む部分の文字設定を探す
TextStyle? styleOf(WidgetTester tester, String text) {
  for (final rich in tester.widgetList<RichText>(find.byType(RichText))) {
    TextStyle? found;
    rich.text.visitChildren((span) {
      if (span is TextSpan && (span.text ?? '').contains(text)) {
        found = span.style;
        return false;
      }
      return true;
    });
    if (found != null) return found;
  }
  return null;
}

/// 画面に描かれた文をすべてつなげたもの
String allText(WidgetTester tester) => tester
    .widgetList<RichText>(find.byType(RichText))
    .map((r) => r.text.toPlainText())
    .join('\n');

void main() {
  late ControlledAssistant assistant;
  late ProviderContainer container;

  setUp(() {
    assistant = ControlledAssistant();
    container = ProviderContainer(overrides: [
      assistantServiceProvider.overrideWithValue(assistant),
    ]);
  });
  tearDown(() => container.dispose());

  Future<void> exchange(WidgetTester tester, String said, String reply) async {
    assistant.reply = reply;
    await tester.pumpWidget(UncontrolledProviderScope(
      container: container,
      child: const MaterialApp(home: RapiScreen()),
    ));
    await tester.pump();
    await tester.enterText(find.byType(TextField), said);
    await tester.pump();
    await tester.tap(find.byKey(const ValueKey('rapi-send')));
    await tester.pump();
    assistant.succeed();
    await tester.pumpAndSettle();
  }

  testWidgets('太字と箇条書きは記号のまま出ずに描かれる', (tester) async {
    await exchange(tester, '今日やること', '今日は **資料づくり** が先です。\n\n- 下書きを書く\n- 図を入れる');

    // 先頭は挨拶（これもラピの発言）なので、最後の行が返答
    final reply = find.byType(RapiReplyMessage).last;
    expect(find.descendant(of: reply, matching: find.byType(RapiMessageMarkdown)), findsOneWidget);

    final text = allText(tester);
    expect(text, isNot(contains('**')));
    expect(text, isNot(contains('- 下書き')));
    expect(styleOf(tester, '資料づくり')?.fontWeight, FontWeight.w700);
    expect(find.text('下書きを書く'), findsOneWidget);
    expect(find.text('図を入れる'), findsOneWidget);
    expect(find.text('•'), findsNWidgets(2));
  });

  testWidgets('見出しは本文より少し大きい太字、コードは記号を外して描く', (tester) async {
    await exchange(
      tester,
      'まとめて',
      '## 進め方\n\n本文です。`flutter test` で確かめます。\n\n```dart\nfinal a = 1;\n```',
    );
    final text = allText(tester);
    expect(text, isNot(contains('##')));
    expect(text, isNot(contains('```')));
    expect(text, isNot(contains('`flutter test`')));

    final heading = styleOf(tester, '進め方')!;
    final body = styleOf(tester, '本文です')!;
    expect(heading.fontWeight, FontWeight.w700);
    expect(heading.fontSize, 17);
    expect(body.fontSize, 15);
    expect(body.height, 1.6);

    // インラインコードはチップ、コードブロックは横スクロールできる箱
    expect(find.byKey(const ValueKey('rapi-inline-code')), findsOneWidget);
    expect(find.text('flutter test'), findsOneWidget);
    expect(find.text('final a = 1;'), findsOneWidget);
    final codeScroll = find.ancestor(
        of: find.text('final a = 1;'), matching: find.byType(SingleChildScrollView));
    expect(tester.widget<SingleChildScrollView>(codeScroll.first).scrollDirection, Axis.horizontal);
  });

  testWidgets('リンクはラピ色で、押すと許可したリンクだけ開く', (tester) async {
    final opened = <Uri>[];
    await tester.pumpWidget(MaterialApp(
      home: Scaffold(
        body: RapiMessageMarkdown(
          data: '[資料](https://example.com/doc) と [危ない](javascript:alert(1))',
          launcher: (uri) async {
            opened.add(uri);
            return true;
          },
        ),
      ),
    ));
    expect(styleOf(tester, '資料')?.color, const Color(0xFF7C3AED));
    await tester.tapOnText(find.textRange.ofSubstring('資料'));
    await tester.pumpAndSettle();
    expect(opened, [Uri.parse('https://example.com/doc')]);

    await tester.tapOnText(find.textRange.ofSubstring('危ない'));
    await tester.pumpAndSettle();
    expect(opened, hasLength(1));
    expect(find.textContaining('リンクを開けませんでした'), findsOneWidget);
  });

  testWidgets('ユーザーの発言は Markdown にしない（書いたまま出す）', (tester) async {
    await exchange(tester, '**そのまま**', 'はい');
    expect(find.text('**そのまま**'), findsOneWidget);
  });
}
