/// NoteInlineHtml
///
/// ノート本文に埋め込まれた許可済みの装飾 HTML（文字色・ハイライト・文字サイズ・下線）を
/// スマホのノート表示で描画する。許可した正規形（PC・サーバーが保存する形）だけを解釈し、
/// それ以外の HTML は今までどおり文字として表示する。
/// 正規形の入れ子の順序は外側から font-size、color、mark、u（docs/design/note-markdown-format.md）。
/// It is NOT responsible for stripping HTML; the server does that on save.
library;

import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:markdown/markdown.dart' as md;

/// 解析した装飾を表す要素のタグ名。
const String noteInlineHtmlTag = 'noteinline';

/// 文字サイズとして受け付ける範囲（px）。PC・サーバーと同じ。
const int noteFontSizeMin = 8;
const int noteFontSizeMax = 72;

// 正規順に並んだ許可形の開始タグの連なり。各タグは省略できる。
final RegExp _openRun = RegExp(
  r'(?:<span style="font-size:(\d{1,2})px">)?'
  r'(?:<span style="color:(#[0-9A-Fa-f]{6})">)?'
  r'(?:<mark style="background-color:(#[0-9A-Fa-f]{6})">)?'
  r'(<u>)?',
);

/// 許可形の開始タグの連なり・中身・対応する終了タグの連なりを 1 回で照合する構文。
class NoteInlineHtmlSyntax extends md.InlineSyntax {
  NoteInlineHtmlSyntax() : super('<', startCharacter: 0x3C);

  @override
  bool tryMatch(md.InlineParser parser, [int? startMatchPos]) {
    final start = startMatchPos ?? parser.pos;
    final source = parser.source;
    if (start >= source.length || source.codeUnitAt(start) != 0x3C) return false;
    final open = _openRun.matchAsPrefix(source, start);
    // 何も一致しない（許可形でない）ときは false。長さ 0 で true を返すと構文解析が止まらない。
    if (open == null || open.end == start) return false;
    final size = open.group(1);
    final color = open.group(2);
    final highlight = open.group(3);
    final underline = open.group(4) != null;
    if (size != null) {
      final px = int.parse(size);
      if (px < noteFontSizeMin || px > noteFontSizeMax) return false;
    }
    final closing = '${underline ? '</u>' : ''}${highlight != null ? '</mark>' : ''}'
        '${color != null ? '</span>' : ''}${size != null ? '</span>' : ''}';
    final closeAt = source.indexOf(closing, open.end);
    if (closeAt < 0) return false;

    final inner = source.substring(open.end, closeAt);
    final element = md.Element(noteInlineHtmlTag, md.InlineParser(inner, parser.document).parse());
    if (size != null) element.attributes['fontSize'] = size;
    if (color != null) element.attributes['color'] = color;
    if (highlight != null) element.attributes['highlight'] = highlight;
    if (underline) element.attributes['underline'] = 'true';

    parser.writeText();
    parser.addNode(element);
    parser.consume(closeAt + closing.length - parser.pos);
    return true;
  }

  @override
  bool onMatch(md.InlineParser parser, Match match) => false;
}

Color _hex(String value) => Color(int.parse('FF${value.substring(1)}', radix: 16));

TextDecoration _addDecoration(TextDecoration? current, TextDecoration added) =>
    current == null || current == TextDecoration.none
        ? added
        : TextDecoration.combine([current, added]);

/// 装飾要素とその子（太字・斜体・取り消し線・コード・入れ子の装飾）を TextSpan にする。
class NoteInlineHtmlBuilder extends MarkdownElementBuilder {
  @override
  Widget? visitElementAfterWithContext(
    BuildContext context,
    md.Element element,
    TextStyle? preferredStyle,
    TextStyle? parentStyle,
  ) {
    final base = parentStyle ?? DefaultTextStyle.of(context).style;
    return Text.rich(TextSpan(children: _spans(element, base, explicitColor: false)));
  }

  List<InlineSpan> _spans(md.Node node, TextStyle style, {required bool explicitColor}) {
    if (node is md.Text) return [TextSpan(text: node.text, style: style)];
    if (node is! md.Element) return const [];
    var next = style;
    var coloured = explicitColor;
    switch (node.tag) {
      case noteInlineHtmlTag:
        final attrs = node.attributes;
        final size = attrs['fontSize'];
        if (size != null) next = next.copyWith(fontSize: double.parse(size));
        final color = attrs['color'];
        if (color != null) {
          next = next.copyWith(color: _hex(color));
          coloured = true;
        }
        final highlight = attrs['highlight'];
        if (highlight != null) {
          // PC の note 密度と同じく、明るいハイライトの上の文字は暗くする（利用者が色を付けた文字は除く）。
          next = next.copyWith(
            backgroundColor: _hex(highlight),
            color: coloured ? next.color : Colors.black87,
          );
        }
        if (attrs['underline'] == 'true') {
          next = next.copyWith(decoration: _addDecoration(next.decoration, TextDecoration.underline));
        }
      case 'strong':
        next = next.copyWith(fontWeight: FontWeight.bold);
      case 'em':
        next = next.copyWith(fontStyle: FontStyle.italic);
      case 'del':
        next = next.copyWith(decoration: _addDecoration(next.decoration, TextDecoration.lineThrough));
      case 'code':
        next = next.copyWith(fontFamily: 'monospace');
      case 'br':
        return [TextSpan(text: '\n', style: style)];
    }
    return [
      for (final child in node.children ?? const <md.Node>[])
        ..._spans(child, next, explicitColor: coloured),
    ];
  }
}

/// ノート表示に渡す構文（新しいリストを返すので、呼び出し側で保持してよい）。
List<md.InlineSyntax> noteInlineHtmlSyntaxes() => [NoteInlineHtmlSyntax()];

/// ノート表示に渡す builder。
Map<String, MarkdownElementBuilder> noteInlineHtmlBuilders() =>
    {noteInlineHtmlTag: NoteInlineHtmlBuilder()};
