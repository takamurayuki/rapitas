/// ノート本文の許可した装飾 HTML（文字色・ハイライト・文字サイズ・下線）が
/// スマホのノート表示で描画されることを確かめる。
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rapitas_mobile/widgets/markdown/note_content_markdown.dart';

Future<void> pumpNote(WidgetTester tester, String data) async {
  await tester.pumpWidget(MaterialApp(
    home: Scaffold(body: SingleChildScrollView(child: NoteContentMarkdown(data: data))),
  ));
}

/// 描画された RichText の中から、文字列が [text] の TextSpan を探す。
TextSpan? findSpan(WidgetTester tester, String text) {
  TextSpan? found;
  for (final rich in tester.widgetList<RichText>(find.byType(RichText))) {
    rich.text.visitChildren((span) {
      if (span is TextSpan && span.text == text) {
        found = span;
        return false;
      }
      return true;
    });
    if (found != null) break;
  }
  return found;
}

void main() {
  testWidgets('文字色を描画する', (tester) async {
    await pumpNote(tester, '<span style="color:#E53935">赤字</span>');
    expect(findSpan(tester, '赤字')?.style?.color, const Color(0xFFE53935));
  });

  testWidgets('ハイライトを描画する', (tester) async {
    await pumpNote(tester, '<mark style="background-color:#FFF59D">重要</mark>');
    final span = findSpan(tester, '重要');
    expect(span?.style?.backgroundColor, const Color(0xFFFFF59D));
    // 明るい背景の上でも読めるよう、文字は暗い色にする（ダークモード対策）。
    expect(span?.style?.color, Colors.black87);
  });

  testWidgets('文字サイズを描画する', (tester) async {
    await pumpNote(tester, '<span style="font-size:24px">大</span>');
    expect(findSpan(tester, '大')?.style?.fontSize, 24);
  });

  testWidgets('下線を描画する', (tester) async {
    await pumpNote(tester, '<u>下線</u>');
    expect(findSpan(tester, '下線')?.style?.decoration, TextDecoration.underline);
  });

  testWidgets('色の中の太字は色と太字の両方を持つ', (tester) async {
    await pumpNote(tester, '<span style="color:#E53935">**太**</span>');
    final span = findSpan(tester, '太');
    expect(span?.style?.color, const Color(0xFFE53935));
    expect(span?.style?.fontWeight, FontWeight.bold);
  });

  testWidgets('入れ子の装飾（サイズの中に色）を両方描画する', (tester) async {
    await pumpNote(
        tester, '<span style="font-size:24px"><span style="color:#E53935">大赤</span></span>');
    final span = findSpan(tester, '大赤');
    expect(span?.style?.fontSize, 24);
    expect(span?.style?.color, const Color(0xFFE53935));
  });

  testWidgets('前後の文章と同じ段落に並ぶ', (tester) async {
    await pumpNote(tester, '前<span style="color:#E53935">赤</span>後');
    expect(findSpan(tester, '赤')?.style?.color, const Color(0xFFE53935));
    expect(find.textContaining('前', findRichText: true), findsOneWidget);
  });

  testWidgets('許可していない style は装飾として解釈しない', (tester) async {
    await pumpNote(tester, '<span style="font-family:x">a</span>');
    expect(find.textContaining('font-family', findRichText: true), findsOneWidget);
  });

  testWidgets('範囲外の文字サイズは装飾として解釈しない', (tester) async {
    await pumpNote(tester, '<span style="font-size:96px">巨大</span>');
    final sizes = <double?>[];
    for (final rich in tester.widgetList<RichText>(find.byType(RichText))) {
      rich.text.visitChildren((span) {
        sizes.add(span.style?.fontSize);
        return true;
      });
    }
    expect(sizes, isNot(contains(96)));
    expect(find.textContaining('font-size', findRichText: true), findsOneWidget);
  });
}
